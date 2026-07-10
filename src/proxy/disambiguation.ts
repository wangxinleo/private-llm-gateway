import { PRIVACY_DISAMBIGUATION_MODE, PRIVACY_NOTICE_TEXT } from "@/config";
import type { ScanResult } from "@/types";

export interface DisambiguationContext {
  readonly contentType: string;
  readonly maskedBody: string;
  readonly scanResult: ScanResult;
}

const NOTICE_PREFIX = "[Privacy notice]";
const STANDARD_PROMPT_FIELDS = ["system", "instructions", "prompt", "input"] as const;
const PREFERRED_MESSAGE_ROLES = new Set(["system", "developer"]);

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

function prefixNotice(text: string, notice: string): string {
  if (text.startsWith(NOTICE_PREFIX)) return text;
  return `${NOTICE_PREFIX} ${notice}\n\n${text}`;
}

function injectIntoContent(content: unknown, notice: string): unknown | null {
  if (typeof content === "string") {
    return prefixNotice(content, notice);
  }

  if (!Array.isArray(content)) return null;

  for (let index = 0; index < content.length; index += 1) {
    const part = content[index];
    if (!isRecord(part) || typeof part.text !== "string") continue;

    const nextParts = content.slice();
    nextParts[index] = { ...part, text: prefixNotice(part.text, notice) };
    return nextParts;
  }

  return null;
}

function injectIntoMessages(messages: unknown[], notice: string): unknown[] {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!isRecord(message) || typeof message.role !== "string") continue;
    if (!PREFERRED_MESSAGE_ROLES.has(message.role)) continue;

    const nextContent = injectIntoContent(message.content, notice);
    if (nextContent === null) continue;

    const nextMessages = messages.slice();
    nextMessages[index] = { ...message, content: nextContent };
    return nextMessages;
  }

  return [
    { role: "system", content: `${NOTICE_PREFIX} ${notice}` },
    ...messages,
  ];
}

function injectIntoStandardFields(
  body: Record<string, unknown>,
  notice: string
): Record<string, unknown> | null {
  for (const field of STANDARD_PROMPT_FIELDS) {
    const value = body[field];

    if (typeof value === "string") {
      return { ...body, [field]: prefixNotice(value, notice) };
    }

    if (Array.isArray(value)) {
      const nextContent = injectIntoContent(value, notice);
      if (nextContent !== null) {
        return { ...body, [field]: nextContent };
      }
    }
  }
  return null;
}

function injectJsonPromptNotice(body: string, notice: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;

  // Prefer standard top-level prompt fields first (Anthropic system, prompt/input APIs).
  const withStandardField = injectIntoStandardFields(parsed, notice);
  if (withStandardField) {
    return JSON.stringify(withStandardField);
  }

  if (Array.isArray(parsed.messages)) {
    return JSON.stringify({
      ...parsed,
      messages: injectIntoMessages(parsed.messages, notice),
    });
  }

  // Keep schema-clean JSON when no standard prompt surface exists.
  return body;
}

function injectTextPrefix(body: string, notice: string): string {
  return prefixNotice(body, notice);
}

export function applyDisambiguation(context: DisambiguationContext): string {
  const { contentType, maskedBody, scanResult } = context;

  if (PRIVACY_DISAMBIGUATION_MODE === "off") return maskedBody;
  if (scanResult.action !== "mask" || !scanResult.maskSummary.applied) return maskedBody;
  if (isMultipartContentType(contentType)) return maskedBody;

  const notice = buildNotice(scanResult);

  if (PRIVACY_DISAMBIGUATION_MODE === "prefix") {
    return injectTextPrefix(maskedBody, notice);
  }

  // auto (and legacy json-meta alias): only mutate standard prompt surfaces.
  if (isJsonContentType(contentType)) {
    return injectJsonPromptNotice(maskedBody, notice) ?? injectTextPrefix(maskedBody, notice);
  }

  return injectTextPrefix(maskedBody, notice);
}
