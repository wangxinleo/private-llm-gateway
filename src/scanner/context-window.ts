import type { Finding, HighRiskAssets } from "@/types";
import { scanSecrets, scanSecretPrefixes } from "./secrets";
import { scanContextKey, locateSensitiveHits } from "./context-key";
import { scanPii } from "./pii";
import { locateHighRiskAssets, type AssetHit } from "./high-risk-assets";
import { HIGH_RISK_ASSETS, CONTEXT_WINDOW_SIZE } from "@/config";

export const CONTEXT_WINDOW = CONTEXT_WINDOW_SIZE.value;

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

  // 窗口锚点:白名单资产(domains/emails/accounts)+ 敏感键值对(secret/encoded key=value)
  // 锚点命中后,窗口内扫描 secrets + context-key;endpoint/identity 键不再触发窗口
  const sensitiveRanges: AssetHit[] = locateSensitiveHits(text).map((h) => ({ value: h.value, start: h.start, end: h.end }));
  const hits: AssetHit[] = [...sensitiveRanges, ...locateHighRiskAssets(text, assets)];

  for (const hit of hits) {
    const window = sliceWindow(text, hit);
    push(scanPii(window).filter((f) => f.category === "EMAIL"));
    push(scanSecrets(window).filter((f) => f.category !== "BASIC_AUTH"));
    push(scanContextKey(window));
  }

  // 自定义前缀密文全文扫描(排在窗口扫描后:窗口内已有类别的值由 push 去重保留)
  push(scanSecretPrefixes(text));

  return allFindings;
}
