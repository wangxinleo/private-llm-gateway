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

function maskStringValue(value: string, findings: Finding[]): string {
  let masked = value;
  for (const finding of findings) {
    if (finding.action === "mask" && finding.maskTag) {
      masked = masked.replaceAll(finding.matched, finding.maskTag);
    }
  }
  return masked;
}

function scanValue(
  value: unknown,
  scan: ScanFn,
  findings: Finding[],
  path: string[] = []
): unknown {
  if (typeof value === "string") {
    const scanText = buildContextText(value, path);
    const result = scan(scanText, byteLength(scanText));

    for (const finding of result.findings) {
      if (result.action === "block") {
        if (isBlockCategory(finding.category)) findings.push(finding);
      } else {
        findings.push(finding);
      }
    }

    if (result.action === "block") {
      return value;
    }

    return maskStringValue(value, result.findings);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => scanValue(item, scan, findings, [...path, String(index)]));
  }

  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = scanValue(obj[key], scan, findings, [...path, key]);
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

  if (findings.some((f) => isBlockCategory(f.category))) {
    return { findings, maskedBody: body, action: "block", maskSummary: { applied: false, categories: [], replacementCount: 0 } };
  }

  if (findings.length > 0) {
    const maskFindings = findings.filter((f) => f.action === "mask");
    return {
      findings,
      maskedBody: JSON.stringify(masked),
      action: "mask",
      maskSummary: {
        applied: maskFindings.length > 0,
        categories: [...new Set(maskFindings.map((f) => f.category))],
        replacementCount: maskFindings.length,
      },
    };
  }

  return { findings, maskedBody: JSON.stringify(masked), action: "allow", maskSummary: { applied: false, categories: [], replacementCount: 0 } };
}
