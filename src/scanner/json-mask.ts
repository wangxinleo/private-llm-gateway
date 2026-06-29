import type { Finding, ScanResult } from "@/types";
import { isBlockCategory } from "@/types";

type ScanFn = (text: string, size: number) => ScanResult;

export function isJsonContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase().trim();
  return ct.startsWith("application/json") || ct.includes("+json");
}

function scanValue(
  value: unknown,
  scan: ScanFn,
  findings: Finding[]
): unknown {
  if (typeof value === "string") {
    const result = scan(value, value.length);

    if (result.action === "block") {
      for (const f of result.findings) {
        if (isBlockCategory(f.category)) findings.push(f);
      }
      return value;
    }

    for (const f of result.findings) {
      findings.push(f);
    }

    return result.maskedBody !== value ? result.maskedBody : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scanValue(item, scan, findings));
  }

  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = scanValue(obj[key], scan, findings);
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
    return scan(body, body.length);
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
