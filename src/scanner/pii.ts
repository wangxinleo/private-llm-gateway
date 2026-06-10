import type { Finding } from "@/types";

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
  maskTag: string;
  validate?: (match: string) => boolean;
}

const PII_RULES: PiiRule[] = [
  { category: "PHONE", pattern: PHONE_RE, maskTag: "[PHONE]" },
  { category: "EMAIL", pattern: EMAIL_RE, maskTag: "[EMAIL]" },
  {
    category: "ID_CARD",
    pattern: ID_CARD_RE,
    maskTag: "[ID_CARD]",
  },
  {
    category: "BANK_CARD",
    pattern: BANK_CARD_RE,
    maskTag: "[BANK_CARD]",
    validate: luhnCheck,
  },
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
        maskTag: rule.maskTag,
      });
    }
  }
  return findings;
}

export function applyMasks(text: string, findings: Finding[]): string {
  let result = text;
  const maskFindings = findings.filter((f) => f.action === "mask" && f.maskTag);
  for (const f of maskFindings) {
    if (f.maskTag) {
      result = result.replaceAll(f.matched, f.maskTag);
    }
  }
  return result;
}
