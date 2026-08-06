import type { Finding, HighRiskAssets } from "@/types";
import { scanSecrets } from "./secrets";
import { scanContextKey, locateSensitiveHits } from "./context-key";
import { scanPii } from "./pii";
import { locateHighRiskAssets, type AssetHit } from "./high-risk-assets";
import { buildMaskTag } from "./mask-tag";
import { HIGH_RISK_ASSETS } from "@/config";

export const CONTEXT_WINDOW = 200;

const KEYWORD_RE = /\b(token|basic|secret|password|api[ _-]?key|authorization|bearer|signing|credential|auth)\b/i;

const PASSWORD_FLAG_RE = /\b(?:passwd|password|pwd|password_hash|pass|key)\s*[:=]\s*(\S+)/gi;

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

export function hasStrongSecretSignal(window: string): boolean {
  const flagRe = new RegExp(PASSWORD_FLAG_RE.source, PASSWORD_FLAG_RE.flags);
  flagRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = flagRe.exec(window)) !== null) {
    const val = m[1];
    if (val && isChaosToken(val.replace(/^["']|["']$/g, ""), 6)) return true;
  }

  if (scanSecrets(window).length > 0) return true;

  const chaosRe = new RegExp(CHAOS_TOKEN_RE.source, CHAOS_TOKEN_RE.flags);
  chaosRe.lastIndex = 0;
  while ((m = chaosRe.exec(window)) !== null) {
    if (isChaosToken(m[0])) return true;
  }

  if (KEYWORD_RE.test(window)) {
    if (scanSecrets(window).length > 0) return true;
    const chaosSource = new RegExp(CHAOS_TOKEN_RE.source, CHAOS_TOKEN_RE.flags);
    chaosSource.lastIndex = 0;
    while ((m = chaosSource.exec(window)) !== null) {
      if (isChaosToken(m[0], 6)) return true;
    }
  }

  return false;
}

export function sliceWindow(text: string, hit: AssetHit, radius: number = CONTEXT_WINDOW): string {
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

  // PII 全文扫描:稳定格式,误报率低,用户确认保留
  push(scanPii(text));

  // D5 内置高信号层:STRONG_RULES 前缀全局扫描,不可关闭,防漏报
  // BASIC_AUTH 排除:真实 basic 凭证按用户决策不需隐藏(受窗口上下文裁决约束)
  const globalSecrets = scanSecrets(text).filter((f) => f.category !== "BASIC_AUTH");
  push(globalSecrets);

  const sensitiveHits = locateSensitiveHits(text);
  const sensitiveRanges: AssetHit[] = sensitiveHits.map((h) => ({ value: h.value, start: h.start, end: h.end }));
  const globalSecretValues = new Set(globalSecrets.map((f) => f.matched));

  const hits: AssetHit[] = [
    ...locateHighRiskAssets(text, assets),
    ...sensitiveRanges,
  ];

  for (const hit of hits) {
    const window = sliceWindow(text, hit);

    const isSensitiveKeyHit = sensitiveRanges.some(
      (r) => r.start === hit.start && r.end === hit.end
    );
    if (!isSensitiveKeyHit && !hasStrongSecretSignal(window)) continue;

    // 窗口内 secrets:跳过全局已覆盖的值,避免重复扫描全文
    const windowSecrets = scanSecrets(window).filter(
      (f) => f.category !== "BASIC_AUTH" && !globalSecretValues.has(f.matched)
    );
    push(windowSecrets);
    push(scanContextKey(window));
    push(scanChaosTokens(window));
  }

  return allFindings;
}
