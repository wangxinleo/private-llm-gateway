import type { Finding, SizeTier, ScanResult } from "@/types";
import { isBlockCategory } from "@/types";
import { scanSecrets } from "./secrets";
import { scanContextKey } from "./context-key";
import { scanPii, applyMasks } from "./pii";
import { scanFilename } from "./filename";
import { SIZE_THRESHOLDS, CHUNK_SIZE } from "@/config";
import { Logger } from "@/log";

const log = new Logger("pipeline");

export function getSizeTier(bodySize: number): SizeTier {
  if (bodySize < SIZE_THRESHOLDS.FULL_SCAN) return "full";
  if (bodySize < SIZE_THRESHOLDS.CHUNKED_SCAN) return "chunked";
  return "minimal";
}

function scanTextFull(text: string): Finding[] {
  const findings: Finding[] = [];

  const secretFindings = scanSecrets(text);
  findings.push(...secretFindings);

  const contextFindings = scanContextKey(text);
  findings.push(...contextFindings);

  const piiFindings = scanPii(text);
  findings.push(...piiFindings);

  return findings;
}

function scanTextMinimal(text: string): Finding[] {
  const findings: Finding[] = [];

  const secretFindings = scanSecrets(text);
  findings.push(...secretFindings);

  const piiFindings = scanPii(text);
  findings.push(...piiFindings);

  return findings;
}

function scanTextChunked(text: string): Finding[] {
  const allFindings: Finding[] = [];
  const seen = new Set<string>();

  for (let offset = 0; offset < text.length; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, text.length);
    const chunk = text.slice(offset, end);

    if (allFindings.some((f) => isBlockCategory(f.category))) {
      break;
    }

    let chunkFindings: Finding[];
    chunkFindings = scanSecrets(chunk);
    for (const f of chunkFindings) {
      if (!seen.has(f.matched)) {
        seen.add(f.matched);
        allFindings.push(f);
      }
    }

    chunkFindings = scanContextKey(chunk);
    for (const f of chunkFindings) {
      if (!seen.has(f.matched)) {
        seen.add(f.matched);
        allFindings.push(f);
      }
    }

    if (allFindings.some((f) => isBlockCategory(f.category))) break;
  }

  const piiFindings = scanPii(text);
  allFindings.push(...piiFindings);

  return allFindings;
}

function scanText(text: string, tier: SizeTier): Finding[] {
  switch (tier) {
    case "full":
      return scanTextFull(text);
    case "chunked":
      return scanTextChunked(text);
    case "minimal":
      return scanTextMinimal(text);
  }
}

export function runPipeline(
  text: string,
  bodySize: number,
  filenames: string[] = []
): ScanResult {
  const tier = getSizeTier(bodySize);
  
  log.debug(`scan start | size: ${bodySize} bytes | tier: ${tier} | filenames: [${filenames.join(", ")}]`);
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
    };
  }

  const textFindings = scanText(text, tier);
  const allFindings = [...fileFindings, ...textFindings];

  log.debug(`scan complete | total findings: ${allFindings.length}`);
  for (const f of allFindings) {
    log.debug(`→ ${f.category} | action: ${f.action} | matched preview: ${f.matched.slice(0, 80)}...`);
  }

  const hasMask = allFindings.some((f) => f.action === "mask");

  if (hasMask) {
    log.debug("decision: MASK (脱敏后转发)");
    return {
      findings: allFindings,
      maskedBody: applyMasks(text, allFindings),
      action: "mask",
    };
  }

  log.debug("decision: ALLOW (放行，未命中任何规则)");
  return {
    findings: [],
    maskedBody: text,
    action: "allow",
  };
}
