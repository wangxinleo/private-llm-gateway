import type { Finding, ScanResult } from "@/types";
import { isBlockCategory } from "@/types";
import { scanFilename } from "./filename";
import { scanContextWindows } from "./context-window";
import { applyMasks } from "./pii";
import { Logger } from "@/log";

const log = new Logger("pipeline");

function scanText(text: string): Finding[] {
  const findings = scanContextWindows(text);
  log.debug(`context-window scan complete | findings: ${findings.length}`);
  return findings;
}

export function runPipeline(
  text: string,
  bodySize: number,
  filenames: string[] = []
): ScanResult {
  log.debug(`scan start | size: ${bodySize} bytes | filenames: [${filenames.join(", ")}]`);
  log.debug(`body preview (first 200 chars): ${text.slice(0, 200)}`);

  const fileFindings: Finding[] = [];
  for (const name of filenames) {
    const r = scanFilename(name);
    if (r) fileFindings.push(r);
  }
  if (fileFindings.some((f) => isBlockCategory(f.category))) {
    return {
      findings: fileFindings,
      maskedBody: text,
      action: "block",
      maskSummary: { applied: false, categories: [], replacementCount: 0 },
    };
  }

  const textFindings = scanText(text);
  const allFindings = [...fileFindings, ...textFindings];

  log.debug(`scan complete | total findings: ${allFindings.length}`);
  for (const f of allFindings) {
    log.debug(`→ ${f.category} | action: ${f.action} | matched preview: ${f.matched.slice(0, 80)}...`);
  }

  const hasMask = allFindings.some((f) => f.action === "mask");

  if (hasMask) {
    log.debug("decision: MASK (脱敏后转发)");
    const maskResult = applyMasks(text, allFindings);
    const maskCategories = [...new Set(allFindings.filter((f) => f.action === "mask").map((f) => f.category))];
    return {
      findings: allFindings,
      maskedBody: maskResult.masked,
      action: "mask",
      maskSummary: {
        applied: maskResult.replacementCount > 0,
        categories: maskCategories,
        replacementCount: maskResult.replacementCount,
      },
    };
  }

  log.debug("decision: ALLOW (放行，未命中任何强制规则)");
  return {
    findings: allFindings,
    maskedBody: text,
    action: "allow",
    maskSummary: { applied: false, categories: [], replacementCount: 0 },
  };
}
