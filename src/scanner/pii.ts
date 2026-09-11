import type { Finding } from "@/types";
import { buildMaskTag, TAG_RE } from "./mask-tag";
import type { MaskRegistry } from "./mask-registry";

// PII 正则都加边界前缀,避免长串(base64/token/时间戳)内子串误匹配,
// 同时消除贪婪匹配失败的 O(n²) 回溯(真实 1.18MB 请求 scanPii 1062ms 的根因)
const PHONE_RE = /(?<!\d)1[3-9]\d{9}/g;
const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ID_CARD_RE = /(?<!\d)\d{17}[\dXx]/g;
const BANK_CARD_RE = /(?<!\d)\d{16,19}/g;

function idCardCheck(num: string): boolean {
  if (num.length !== 18) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkCodes = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const d = parseInt(num[i] ?? "", 10);
    if (Number.isNaN(d)) return false;
    sum += d * (weights[i] ?? 0);
  }
  const expected = checkCodes[sum % 11];
  return expected?.toUpperCase() === (num[17] ?? "").toUpperCase();
}

function luhnCheck(num: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    const d = parseInt(num[i] ?? "0", 10);
    if (alt) {
      const doubled = d * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    } else {
      sum += d;
    }
    alt = !alt;
  }
  return sum % 10 === 0;
}

interface PiiRule {
  category: Finding["category"];
  pattern: RegExp;
  validate?: (match: string) => boolean;
}

const PII_RULES: PiiRule[] = [
  { category: "PHONE", pattern: PHONE_RE },
  { category: "EMAIL", pattern: EMAIL_RE },
  { category: "ID_CARD", pattern: ID_CARD_RE, validate: idCardCheck },
  { category: "BANK_CARD", pattern: BANK_CARD_RE, validate: luhnCheck },
];

export function scanPii(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const rule of PII_RULES) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text)) !== null) {
      if (rule.validate && !rule.validate(m[0])) continue;
      findings.push({
        category: rule.category,
        action: "mask",
        matched: m[0],
        maskTag: buildMaskTag(rule.category),
      });
    }
  }
  return findings;
}

export interface MaskResult {
  masked: string;
  replacementCount: number;
  registry?: MaskRegistry;
}

const PLACEHOLDER_SPLIT_RE = new RegExp(`(${TAG_RE.source})`);

export function applyMasks(text: string, findings: Finding[], registry?: MaskRegistry): MaskResult {
  let result = text;
  let replacementCount = 0;
  const maskFindings = findings.filter((f) => f.action === "mask" && f.maskTag);
  for (const f of maskFindings) {
    if (!f.maskTag || !result.includes(f.matched)) continue;
    const tag = registry ? registry.tagFor(f.category, f.matched) : f.maskTag;
    const applied = replaceOutsidePlaceholders(result, f.matched, tag);
    result = applied.text;
    replacementCount += applied.count;
  }
  return { masked: result, replacementCount, registry };
}

function replaceOutsidePlaceholders(text: string, matched: string, tag: string): { text: string; count: number } {
  const segments = text.split(PLACEHOLDER_SPLIT_RE);
  let count = 0;
  for (let i = 0; i < segments.length; i += 2) {
    const segment = segments[i]!;
    if (!segment.includes(matched)) continue;
    count += segment.split(matched).length - 1;
    segments[i] = segment.replaceAll(matched, tag);
  }
  return { text: segments.join(""), count };
}
