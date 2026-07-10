import { PRIVACY_DISAMBIGUATION_MODE, PRIVACY_NOTICE_TEXT } from "@/config";
import type { ScanResult } from "@/types";

export interface DisambiguationContext {
  readonly contentType: string;
  readonly maskedBody: string;
  readonly scanResult: ScanResult;
}

const NOTICE_PREFIX = "[Privacy notice]";
const STANDARD_PROMPT_FIELDS = ["system", "instructions", "prompt", "input"] as const;

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

function appendToContent(content: unknown, noticeText: string): unknown | null {
  if (typeof content === "string") {
    return `${content}\n\n${noticeText}`;
  }

  if (!Array.isArray(content)) return null;

  const lastPart = content[content.length - 1];
  if (isRecord(lastPart) && typeof lastPart.text === "string") {
    const nextParts = content.slice();
    nextParts[content.length - 1] = {
      ...lastPart,
      text: `${lastPart.text}\n\n${noticeText}`,
    };
    return nextParts;
  }

  return [...content, { type: "text", text: noticeText }];
}

function appendToStandardField(
  body: Record<string, unknown>,
  noticeText: string
): Record<string, unknown> | null {
  for (const field of STANDARD_PROMPT_FIELDS) {
    const value = body[field];

    if (typeof value === "string") {
      return { ...body, [field]: `${value}\n\n${noticeText}` };
    }

    if (Array.isArray(value)) {
      const nextContent = appendToContent(value, noticeText);
      if (nextContent !== null) {
        return { ...body, [field]: nextContent };
      }
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
