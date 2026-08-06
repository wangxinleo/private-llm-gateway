import type { Finding, HighRiskAssets } from "@/types";
import { scanSecrets } from "./secrets";
import { scanContextKey, locateSensitiveHits } from "./context-key";
import { scanPii } from "./pii";
import { locateHighRiskAssets, type AssetHit } from "./high-risk-assets";
import { buildMaskTag } from "./mask-tag";
import { HIGH_RISK_ASSETS, CONTEXT_WINDOW_SIZE } from "@/config";

export const CONTEXT_WINDOW = CONTEXT_WINDOW_SIZE.value;

const CHAOS_TOKEN_RE = /\b[A-Za-z0-9_\-]{8,}\b/g;

const PURE_WORD_RE = /^[A-Za-z]+$/;
const PURE_DIGITS_RE = /^[0-9]+$/;
const REPEATED_RE = /^(.)\1+$/;
const KNOWN_PLAINTEXT = /\b(example|test|demo|local|mock|sample|placeholder|dummy|changeme|user|admin|token|password|secret|api[ _-]?key|authorization|bearer|signing|credential|basic|auth|username)\b/i;

function isChaosToken(candidate: string, minLength = 8): boolean {
  if (candidate.length < minLength) return false;
  if (PURE_WORD_RE.test(candidate)) return false;
  if (PURE_DIGITS_RE.test(candidate)) return false;
  if (REPEATED_RE.test(candidate)) return false;
  if (KNOWN_PLAINTEXT.test(candidate)) return false;
  return true;
}

export function scanChaosTokens(window: string): Finding[] {
  const findings: Finding[] = [];
  const re = new RegExp(CHAOS_TOKEN_RE.source, CHAOS_TOKEN_RE.flags);
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) {
    if (isChaosToken(m[0])) {
      findings.push({ category: "CONTEXTUAL_SECRET", action: "mask", matched: m[0], maskTag: buildMaskTag("CONTEXTUAL_SECRET") });
    }
  }
  return findings;
}

export function sliceWindow(text: string, hit: AssetHit, radius: number = CONTEXT_WINDOW_SIZE.value): string {
  return text.slice(Math.max(0, hit.start - radius), Math.min(text.length, hit.end + radius));
}

export function scanContextWindows(
  text: string,
  assets: HighRiskAssets = HIGH_RISK_ASSETS
): Finding[] {
  const allFindings: Finding[] = [];
  const seen = new Set<string>();

  const longerMatchPresent = (candidate: string): boolean => {
    for (const f of allFindings) {
      if (f.matched.length > candidate.length && f.matched.includes(candidate)) return true;
    }
    return false;
  };

  const push = (findings: Finding[]) => {
    for (const f of findings) {
      if (seen.has(f.matched)) continue;
      if (longerMatchPresent(f.matched)) continue;
      for (const existing of [...allFindings]) {
        if (existing.matched.length < f.matched.length && f.matched.includes(existing.matched)) {
          seen.delete(existing.matched);
          allFindings.splice(allFindings.indexOf(existing), 1);
        }
      }
      seen.add(f.matched);
      allFindings.push(f);
    }
  };

  // 仅 PHONE/ID_CARD/BANK_CARD 全文扫描(用户确认保留);EMAIL 收窄到窗口锚点内
  push(scanPii(text).filter((f) => f.category !== "EMAIL"));

  // 窗口锚点:白名单资产(domains/emails/accounts)+ JSON 敏感键值对(key=value)
  // 锚点命中后,窗口内一律严格扫描(secrets + context-key + chaos 全量),无额外门槛
  const sensitiveRanges: AssetHit[] = locateSensitiveHits(text).map((h) => ({ value: h.value, start: h.start, end: h.end }));
  const hits: AssetHit[] = [...sensitiveRanges, ...locateHighRiskAssets(text, assets)];

  for (const hit of hits) {
    const window = sliceWindow(text, hit);
    push(scanPii(window).filter((f) => f.category === "EMAIL"));
    push(scanSecrets(window).filter((f) => f.category !== "BASIC_AUTH"));
    push(scanContextKey(window));
    push(scanChaosTokens(window));
  }

  return allFindings;
}
