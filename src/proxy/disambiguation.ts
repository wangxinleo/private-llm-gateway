import { PRIVACY_DISAMBIGUATION_MODE, PRIVACY_NOTICE_TEXT } from "@/config";
import type { ScanResult } from "@/types";

export interface DisambiguationContext {
  readonly contentType: string;
  readonly maskedBody: string;
  readonly scanResult: ScanResult;
}

const NOTICE_PREFIX = "[Privacy notice]";
const STANDARD_PROMPT_FIELDS = ["system", "instructions", "prompt", "input"] as const;
const GEMINI_SYSTEM_FIELDS = ["system_instruction", "systemInstruction"] as const;

/** Content parts inside message/system blocks (Chat / Anthropic / Responses message content). */
const CONTENT_PART_TYPES = new Set([
  "text",
  "input_text",
  "input_image",
  "input_file",
  "image_url",
  "output_text",
  "refusal",
]);

/**
 * Top-level OpenAI Responses / Codex `input[]` item types.
 * These are NOT multimodal content parts — never append `{ type: "text" }` here.
 */
const RESPONSES_INPUT_ITEM_TYPES = new Set([
  "message",
  "function_call",
  "function_call_output",
  "reasoning",
  "item_reference",
  "web_search_call",
  "file_search_call",
  "computer_call",
  "computer_call_output",
  "code_interpreter_call",
  "image_generation_call",
  "local_shell_call",
  "local_shell_call_output",
  "mcp_call",
  "mcp_list_tools",
  "mcp_approval_request",
  "mcp_approval_response",
  "custom_tool_call",
  "custom_tool_call_output",
  "tool_search_call",
  "tool_search_output",
  "shell_call",
  "shell_call_output",
  "apply_patch_call",
  "apply_patch_call_output",
]);

function buildNotice(scanResult: ScanResult): string {
  const sampleTag = scanResult.maskSummary.categories[0]
    ? `<<PRIVACY_MASK:${scanResult.maskSummary.categories[0]}>>`
    : "<<PRIVACY_MASK:TYPE>>";
  return PRIVACY_NOTICE_TEXT.replace(/<<PRIVACY_MASK:\w+>>/g, sampleTag);
}

function isJsonContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase().trim();
  return lower.startsWith("application/json") || lower.includes("+json");
}

function isMultipartContentType(contentType: string): boolean {
  return contentType.toLowerCase().trim().startsWith("multipart/form-data");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildNoticeText(notice: string): string {
  return `${NOTICE_PREFIX} ${notice}`;
}

function isContentPart(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.type === "string") return CONTENT_PART_TYPES.has(value.type);
  // Gemini-style part: `{ text }` without role/type/call_id
  return (
    typeof value.text === "string" &&
    !("role" in value) &&
    !("call_id" in value) &&
    !("type" in value)
  );
}

function isResponsesInputItem(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.call_id === "string") return true;
  if (typeof value.type === "string" && RESPONSES_INPUT_ITEM_TYPES.has(value.type)) {
    return true;
  }
  // EasyInputMessage: role + content (not a content part)
  if (typeof value.role === "string" && "content" in value && !isContentPart(value)) {
    return true;
  }
  return false;
}

function isResponsesInputArray(value: unknown[]): boolean {
  if (value.length === 0) return false;
  if (value.some(isResponsesInputItem)) return true;
  // Unknown typed items that are not content parts still look like Responses items.
  return value.every((item) => isRecord(item) && !isContentPart(item));
}

function inferTextPartType(parts: unknown[]): "text" | "input_text" {
  for (const part of parts) {
    if (!isRecord(part) || typeof part.type !== "string") continue;
    if (part.type === "input_text") return "input_text";
    if (part.type === "text") return "text";
  }
  return "text";
}

/** Gemini content parts use `{ text }` without a Chat-style `type` field. */
function appendToGeminiParts(parts: unknown[], noticeText: string): unknown[] {
  const lastPart = parts[parts.length - 1];
  if (isRecord(lastPart) && typeof lastPart.text === "string") {
    const nextParts = parts.slice();
    nextParts[parts.length - 1] = {
      ...lastPart,
      text: `${lastPart.text}\n\n${noticeText}`,
    };
    return nextParts;
  }
  return [...parts, { text: noticeText }];
}

function appendToContent(content: unknown, noticeText: string): unknown | null {
  if (typeof content === "string") {
    return `${content}\n\n${noticeText}`;
  }

  if (!Array.isArray(content)) return null;

  // Never mutate OpenAI Responses / Codex input item lists as content parts.
  if (isResponsesInputArray(content)) return null;

  const lastPart = content[content.length - 1];
  if (isRecord(lastPart) && typeof lastPart.text === "string") {
    const nextParts = content.slice();
    nextParts[content.length - 1] = {
      ...lastPart,
      text: `${lastPart.text}\n\n${noticeText}`,
    };
    return nextParts;
  }

  // Untyped `{ text }` parts (Gemini-style) should stay untyped.
  if (content.length === 0 || content.every(isContentPart)) {
    const hasTypedPart = content.some(
      (part) => isRecord(part) && typeof part.type === "string"
    );
    if (!hasTypedPart) {
      return [...content, { text: noticeText }];
    }
  }

  return [...content, { type: inferTextPartType(content), text: noticeText }];
}

function appendToInstructions(
  body: Record<string, unknown>,
  noticeText: string
): Record<string, unknown> {
  const instructions = body.instructions;

  if (typeof instructions === "string") {
    return { ...body, instructions: `${instructions}\n\n${noticeText}` };
  }

  if (Array.isArray(instructions)) {
    const next = appendToContent(instructions, noticeText);
    if (next !== null) {
      return { ...body, instructions: next };
    }
  }

  return { ...body, instructions: noticeText };
}

function injectGeminiSystemInstruction(
  body: Record<string, unknown>,
  noticeText: string
): Record<string, unknown> | null {
  for (const field of GEMINI_SYSTEM_FIELDS) {
    const value = body[field];

    if (typeof value === "string") {
      return { ...body, [field]: `${value}\n\n${noticeText}` };
    }

    if (isRecord(value) && Array.isArray(value.parts)) {
      return {
        ...body,
        [field]: { ...value, parts: appendToGeminiParts(value.parts, noticeText) },
      };
    }
  }

  // Native Gemini generateContent: create system_instruction when contents exist.
  if (Array.isArray(body.contents)) {
    return {
      ...body,
      system_instruction: { parts: [{ text: noticeText }] },
    };
  }

  return null;
}

function appendToStandardField(
  body: Record<string, unknown>,
  noticeText: string
): Record<string, unknown> | null {
  // 1) Prefer string prompt surfaces (safe across protocols).
  for (const field of STANDARD_PROMPT_FIELDS) {
    const value = body[field];
    if (typeof value === "string") {
      return { ...body, [field]: `${value}\n\n${noticeText}` };
    }
  }

  // 2) Top-level `input` arrays are Responses/Codex item lists — never content parts.
  if (Array.isArray(body.input)) {
    return appendToInstructions(body, noticeText);
  }

  // 3) Array content-part surfaces (Anthropic system blocks, etc.).
  for (const field of STANDARD_PROMPT_FIELDS) {
    if (field === "input") continue;
    const value = body[field];
    if (!Array.isArray(value)) continue;

    const nextContent = appendToContent(value, noticeText);
    if (nextContent !== null) {
      return { ...body, [field]: nextContent };
    }
  }

  return null;
}

function appendSystemMessage(messages: unknown[], noticeText: string): unknown[] {
  const noticeContent = `${noticeText}`;

  const lastMessage = messages[messages.length - 1];
  if (
    isRecord(lastMessage) &&
    typeof lastMessage.role === "string" &&
    lastMessage.role === "system"
  ) {
    const nextContent = appendToContent(lastMessage.content, noticeContent);
    if (nextContent !== null) {
      const nextMessages = messages.slice();
      nextMessages[messages.length - 1] = { ...lastMessage, content: nextContent };
      return nextMessages;
    }
  }

  return [...messages, { role: "system", content: noticeContent }];
}

function injectJsonPromptNotice(body: string, noticeText: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;

  const withStandardField = appendToStandardField(parsed, noticeText);
  if (withStandardField) {
    return JSON.stringify(withStandardField);
  }

  const withGemini = injectGeminiSystemInstruction(parsed, noticeText);
  if (withGemini) {
    return JSON.stringify(withGemini);
  }

  if (Array.isArray(parsed.messages)) {
    return JSON.stringify({
      ...parsed,
      messages: appendSystemMessage(parsed.messages, noticeText),
    });
  }

  // Keep schema-clean JSON when no standard prompt surface exists.
  return body;
}

function injectTextSuffix(body: string, noticeText: string): string {
  return `${body}\n\n${noticeText}`;
}

export function applyDisambiguation(context: DisambiguationContext): string {
  const { contentType, maskedBody, scanResult } = context;

  if (PRIVACY_DISAMBIGUATION_MODE === "off") return maskedBody;
  if (scanResult.action !== "mask" || !scanResult.maskSummary.applied) return maskedBody;
  if (isMultipartContentType(contentType)) return maskedBody;

  const notice = buildNotice(scanResult);
  const noticeText = buildNoticeText(notice);

  if (PRIVACY_DISAMBIGUATION_MODE === "prefix") {
    return `${NOTICE_PREFIX} ${notice}\n\n${maskedBody}`;
  }

  if (isJsonContentType(contentType)) {
    return injectJsonPromptNotice(maskedBody, noticeText) ?? injectTextSuffix(maskedBody, noticeText);
  }

  return injectTextSuffix(maskedBody, noticeText);
}
