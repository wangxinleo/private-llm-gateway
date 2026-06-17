import { PRIVACY_DISAMBIGUATION_MODE, PRIVACY_NOTICE_TEXT } from "@/config";
import type { ScanResult } from "@/types";

export interface DisambiguationContext {
  contentType: string;
  maskedBody: string;
  scanResult: ScanResult;
}

const NOTICE_PREFIX = "[Privacy notice]";

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

function injectMessagePrefix(body: string, notice: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed) || !Array.isArray(parsed.messages)) return null;

    for (const message of parsed.messages) {
      if (isRecord(message) && typeof message.content === "string") {
        message.content = `${NOTICE_PREFIX} ${notice}\n\n${message.content}`;
        return JSON.stringify(parsed);
      }
    }
  } catch {
    return null;
  }

  return null;
}

function injectJsonMeta(body: string, scanResult: ScanResult, notice: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed)) return null;

    parsed._privacy_meta = {
      masked: true,
      mask_types: scanResult.maskSummary.categories,
      notice,
    };
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

function injectTextPrefix(body: string, notice: string): string {
  return `${NOTICE_PREFIX} ${notice}\n\n${body}`;
}

export function applyDisambiguation(context: DisambiguationContext): string {
  const { contentType, maskedBody, scanResult } = context;

  if (PRIVACY_DISAMBIGUATION_MODE === "off") return maskedBody;
  if (scanResult.action !== "mask" || !scanResult.maskSummary.applied) return maskedBody;
  if (isMultipartContentType(contentType)) return maskedBody;

  const notice = buildNotice(scanResult);

  if (PRIVACY_DISAMBIGUATION_MODE === "prefix") return injectTextPrefix(maskedBody, notice);

  if (PRIVACY_DISAMBIGUATION_MODE === "json-meta") {
    return isJsonContentType(contentType)
      ? injectJsonMeta(maskedBody, scanResult, notice) ?? injectTextPrefix(maskedBody, notice)
      : injectTextPrefix(maskedBody, notice);
  }

  return isJsonContentType(contentType)
    ? injectMessagePrefix(maskedBody, notice) ??
        injectJsonMeta(maskedBody, scanResult, notice) ??
        injectTextPrefix(maskedBody, notice)
    : injectTextPrefix(maskedBody, notice);
}
