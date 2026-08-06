import type { HighRiskAssets } from "@/types";
import { HIGH_RISK_ASSETS } from "@/config";

export interface AssetHit {
  value: string;
  start: number;
  end: number;
}

// 泛值通配: `*` 匹配任意字符序列(含空);其余字符按字面转义
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

const EMAIL_SPLIT_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

function extractHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(value));
}

function findMatches(text: string, re: RegExp): AssetHit[] {
  re.lastIndex = 0;
  const hits: AssetHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    hits.push({ value: m[0], start: m.index, end: m.index + m[0].length });
  }
  return hits;
}

// 账户名匹配:JSON key/value、URL 路径段、prose 中的字面出现均可命中
function matchAccountsInText(text: string, accounts: string[]): AssetHit[] {
  if (accounts.length === 0) return [];
  const hits: AssetHit[] = [];
  for (const account of accounts) {
    if (!account) continue;
    const re = new RegExp(escapeRegex(account), "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({ value: m[0], start: m.index, end: m.index + m[0].length });
    }
  }
  return hits;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function locateHighRiskAssets(
  text: string,
  assets: HighRiskAssets = HIGH_RISK_ASSETS
): AssetHit[] {
  const hits: AssetHit[] = [];

  if (assets.domains.length > 0) {
    for (const url of findMatches(text, URL_RE)) {
      const host = extractHost(url.value);
      if (host && matchesAny(host, assets.domains)) hits.push(url);
    }
  }

  if (assets.emails.length > 0) {
    for (const email of findMatches(text, EMAIL_SPLIT_RE)) {
      if (matchesAny(email.value, assets.emails)) hits.push(email);
    }
  }

  hits.push(...matchAccountsInText(text, assets.accounts));

  return hits;
}