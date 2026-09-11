import type { Finding, ScanResult } from "@/types";
import { isBlockCategory } from "@/types";
import type { MaskRegistry } from "@/scanner/mask-registry";
import { applyMasks } from "./pii";

type ScanFn = (text: string, size: number, registry?: MaskRegistry) => ScanResult;

const PATH_SEPARATOR = ".";

export function isJsonContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase().trim();
  return ct.startsWith("application/json") || ct.includes("+json");
}

function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

function buildContextText(value: string, path: string[]): string {
  const key = path.at(-1);
  if (!key) return value;

  const fullPath = path.join(PATH_SEPARATOR);
  return key === fullPath
    ? `${key}=${value}`
    : `${key}=${value}\n${fullPath}=${value}`;
}

const DATA_URI_RE = /^data:[a-zA-Z0-9+.-]+\/[a-zA-Z0-9+.-]+;base64,/;
const BASE64_BLOB_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64_BLOB_MIN_LENGTH = 64;

/**
 * 二进制 base64 payload 不被当作文本扫描,否则 BASE64_TOKEN 会误判其中的
 * `eyJ...` 序列并打码,破坏 base64。仅豁免 data URI 与键名 `data` 的长纯 base64
 * (Anthropic/Gemini 图片形态);短值或含 `-`/`_` 的 base64url 仍正常扫描。
 */
function isBinaryPayload(value: string, key: string | undefined): boolean {
  if (DATA_URI_RE.test(value)) return true;
  if (key !== "data" || value.length < BASE64_BLOB_MIN_LENGTH) return false;
  return BASE64_BLOB_RE.test(value);
}

function appendFindings(target: Finding[], additions: Finding[]): void {
  const seen = new Set(target.map((finding) => `${finding.category}\0${finding.action}\0${finding.matched}`));
  for (const finding of additions) {
    const key = `${finding.category}\0${finding.action}\0${finding.matched}`;
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(finding);
  }
}

function maskStringValue(value: string, findings: Finding[], registry?: MaskRegistry): string {
  return applyMasks(value, findings, registry).masked;
}

function findingsForValue(value: string, findings: Finding[]): Finding[] {
  return findings.filter((finding) => finding.action === "mask" && value.includes(finding.matched));
}

function scanStringContext(value: string, scan: ScanFn, path: string[]): ScanResult {
  const scanText = buildContextText(value, path);
  return scan(scanText, byteLength(scanText));
}

function scanObjectContext(
  obj: Record<string, unknown>,
  scan: ScanFn,
  findings: Finding[],
  path: string[]
): Finding[] {
  const contextLines: string[] = [];
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "string" && !isBinaryPayload(value, key)) {
      contextLines.push(buildContextText(value, [...path, key]));
    }
  }

  if (contextLines.length === 0) return [];

  const contextText = contextLines.join("\n");
  const result = scan(contextText, byteLength(contextText));
  appendFindings(findings, result.findings);
  return result.action === "block"
    ? result.findings.filter((finding) => isBlockCategory(finding.category))
    : result.findings;
}

function scanValue(
  value: unknown,
  scan: ScanFn,
  findings: Finding[],
  path: string[] = [],
  siblingFindings: Finding[] = [],
  registry?: MaskRegistry
): unknown {
  if (typeof value === "string") {
    if (isBinaryPayload(value, path.at(-1))) {
      return value;
    }

    const result = scanStringContext(value, scan, path);
    appendFindings(findings, result.findings);

    if (result.action === "block") {
      return value;
    }

    const localFindings = [...siblingFindings, ...result.findings];
    return maskStringValue(value, findingsForValue(value, localFindings), registry);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => scanValue(item, scan, findings, [...path, String(index)], [], registry));
  }

  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const localFindings = scanObjectContext(obj, scan, findings, path);
    for (const key of Object.keys(obj)) {
      const child = obj[key];
      const childSiblingFindings = typeof child === "string" ? localFindings : [];
      result[key] = scanValue(child, scan, findings, [...path, key], childSiblingFindings, registry);
    }
    return result;
  }

  return value;
}

export function maskJsonBody(body: string, scan: ScanFn, registry?: MaskRegistry): ScanResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return scan(body, byteLength(body), registry);
  }

  const findings: Finding[] = [];
  const masked = scanValue(parsed, scan, findings, [], [], registry);

  if (findings.some((finding) => isBlockCategory(finding.category))) {
    return { findings, maskedBody: body, action: "block", maskSummary: { applied: false, categories: [], replacementCount: 0 }, registry };
  }

  if (findings.length > 0) {
    const maskFindings = findings.filter((finding) => finding.action === "mask");
    return {
      findings,
      maskedBody: JSON.stringify(masked),
      action: "mask",
      maskSummary: {
        applied: maskFindings.length > 0,
        categories: [...new Set(maskFindings.map((finding) => finding.category))],
        replacementCount: maskFindings.length,
      },
      registry,
    };
  }

  return { findings, maskedBody: JSON.stringify(masked), action: "allow", maskSummary: { applied: false, categories: [], replacementCount: 0 }, registry };
}
