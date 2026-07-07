import type { Finding, ScanResult } from "@/types";
import { isBlockCategory } from "@/types";

type ScanFn = (text: string, size: number) => ScanResult;

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

function appendFindings(target: Finding[], additions: Finding[]): void {
  const seen = new Set(target.map((finding) => `${finding.category}\0${finding.action}\0${finding.matched}`));
  for (const finding of additions) {
    const key = `${finding.category}\0${finding.action}\0${finding.matched}`;
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(finding);
  }
}

function maskStringValue(value: string, findings: Finding[]): string {
  let masked = value;
  for (const finding of findings) {
    if (finding.action === "mask" && finding.maskTag && masked.includes(finding.matched)) {
      masked = masked.replaceAll(finding.matched, finding.maskTag);
    }
  }
  return masked;
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
    if (typeof value === "string") {
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
  siblingFindings: Finding[] = []
): unknown {
  if (typeof value === "string") {
    const result = scanStringContext(value, scan, path);
    appendFindings(findings, result.findings);

    if (result.action === "block") {
      return value;
    }

    const localFindings = [...siblingFindings, ...result.findings];
    return maskStringValue(value, findingsForValue(value, localFindings));
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => scanValue(item, scan, findings, [...path, String(index)]));
  }

  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const localFindings = scanObjectContext(obj, scan, findings, path);
    for (const key of Object.keys(obj)) {
      const child = obj[key];
      const childSiblingFindings = typeof child === "string" ? localFindings : [];
      result[key] = scanValue(child, scan, findings, [...path, key], childSiblingFindings);
    }
    return result;
  }

  return value;
}

export function maskJsonBody(body: string, scan: ScanFn): ScanResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return scan(body, byteLength(body));
  }

  const findings: Finding[] = [];
  const masked = scanValue(parsed, scan, findings);

  if (findings.some((finding) => isBlockCategory(finding.category))) {
    return { findings, maskedBody: body, action: "block", maskSummary: { applied: false, categories: [], replacementCount: 0 } };
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
    };
  }

  return { findings, maskedBody: JSON.stringify(masked), action: "allow", maskSummary: { applied: false, categories: [], replacementCount: 0 } };
}
