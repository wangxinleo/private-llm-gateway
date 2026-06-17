import type { Finding } from "@/types";
import { buildMaskTag } from "./mask-tag";

const PHONE_RE = /1[3-9]\d{9}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ID_CARD_RE = /\d{17}[\dXx]/g;
const BANK_CARD_RE = /\d{16,19}/g;

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
  { category: "ID_CARD", pattern: ID_CARD_RE },
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
}

export function applyMasks(text: string, findings: Finding[]): MaskResult {
  let result = text;
  let replacementCount = 0;
  const maskFindings = findings.filter((f) => f.action === "mask" && f.maskTag);
  for (const f of maskFindings) {
    if (f.maskTag) {
      const before = result;
      result = result.replaceAll(f.matched, f.maskTag);
      if (result !== before) {
        const count = (before.match(new RegExp(escapeRegex(f.matched), "g")) || []).length;
        replacementCount += count;
      }
    }
  }
  return { masked: result, replacementCount };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
