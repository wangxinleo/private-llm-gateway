import type { Finding, ActionType } from "@/types";
import { buildMaskTag } from "./mask-tag";
import { Logger } from "@/log";

const log = new Logger("scanner");

const PRIVATE_KEY_RE =
  /-----BEGIN\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+)?PRIVATE\s+KEY-----/g;

const BEARER_TOKEN_RE = /Bearer\s+[A-Za-z0-9._~-]+/gi;
const BASIC_AUTH_RE = /Basic\s+[A-Za-z0-9+/]+=*/gi;

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

const COOKIE_HEADER_RE = /(?<![\w-])Cookie:\s*\S+/gi;
const SET_COOKIE_HEADER_RE = /Set-Cookie:\s*\S+/gi;

const DB_URI_RE =
  /(?:postgres|mysql|mongodb|redis):\/\/[^\s@]+:[^\s@]+@[^\s]+/gi;

const AWS_KEY_RE = /(?:AKIA|ASIA)[0-9A-Z]{16}/g;
const GITHUB_TOKEN_RE = /(?:ghp_|github_pat_)[A-Za-z0-9_]{36,}/g;
const SLACK_TOKEN_RE = /xox[bp]-[A-Za-z0-9-]+/g;
const GOOGLE_API_KEY_RE = /AIza[A-Za-z0-9_-]{35}/g;

const BASE64_TOKEN_RE = /eyJ[A-Za-z0-9_-]{40,}/g;
const STRIPE_KEY_RE = /sk_(?:live|test)_[A-Za-z0-9]{24,}/g;
const SENDGRID_KEY_RE = /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g;

interface Rule {
  category: Finding["category"];
  pattern: RegExp;
}

const STRONG_RULES: Rule[] = [
  { category: "PRIVATE_KEY", pattern: PRIVATE_KEY_RE },
  { category: "BEARER_TOKEN", pattern: BEARER_TOKEN_RE },
  { category: "BASIC_AUTH", pattern: BASIC_AUTH_RE },
  { category: "JWT", pattern: JWT_RE },
  { category: "COOKIE_HEADER", pattern: COOKIE_HEADER_RE },
  { category: "SET_COOKIE_HEADER", pattern: SET_COOKIE_HEADER_RE },
  { category: "DB_URI", pattern: DB_URI_RE },
  { category: "AWS_ACCESS_KEY", pattern: AWS_KEY_RE },
  { category: "GITHUB_TOKEN", pattern: GITHUB_TOKEN_RE },
  { category: "SLACK_TOKEN", pattern: SLACK_TOKEN_RE },
  { category: "GOOGLE_API_KEY", pattern: GOOGLE_API_KEY_RE },
  { category: "BASE64_TOKEN", pattern: BASE64_TOKEN_RE },
  { category: "STRIPE_KEY", pattern: STRIPE_KEY_RE },
  { category: "SENDGRID_KEY", pattern: SENDGRID_KEY_RE },
];

interface IndexedFinding {
  category: Finding["category"];
  action: ActionType;
  matched: string;
  maskTag: string;
  start: number;
  end: number;
}

export function scanSecrets(text: string): Finding[] {
  const indexed: IndexedFinding[] = [];
  const seen = new Set<string>();
  for (const rule of STRONG_RULES) {
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.global) {
      const match = rule.pattern.exec(text);
      if (match) {
        const matched = match[0];
        const dedupeKey = `${rule.category}:${match.index}`;
        if (!seen.has(dedupeKey)) {
          log.debug(`HIT: ${rule.category} | matched ${matched.length} chars`);
          seen.add(dedupeKey);
          indexed.push({
            category: rule.category,
            action: "mask",
            matched,
            maskTag: buildMaskTag(rule.category),
            start: match.index,
            end: match.index + matched.length,
          });
        }
      }
    } else {
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(text)) !== null) {
        const matched = match[0];
        const dedupeKey = `${rule.category}:${match.index}`;
        if (!seen.has(dedupeKey)) {
          log.debug(`HIT: ${rule.category} | matched ${matched.length} chars`);
          seen.add(dedupeKey);
          indexed.push({
            category: rule.category,
            action: "mask",
            matched,
            maskTag: buildMaskTag(rule.category),
            start: match.index,
            end: match.index + matched.length,
          });
        }
      }
    }
  }

  const jwtRanges = indexed.filter(f => f.category === "JWT");
  if (jwtRanges.length > 0) {
    const pruned = indexed.filter(f => {
      if (f.category !== "BASE64_TOKEN") return true;
      return !jwtRanges.some(jwt => f.start >= jwt.start && f.end <= jwt.end);
    });
    log.debug(`secrets scan complete | findings: ${pruned.length} | categories: [${pruned.map(f => f.category).join(", ")}]`);
    return pruned.map(f => ({ category: f.category, action: f.action, matched: f.matched, maskTag: f.maskTag }));
  }

  log.debug(`secrets scan complete | findings: ${indexed.length} | categories: [${indexed.map(f => f.category).join(", ")}]`);
  return indexed.map(f => ({ category: f.category, action: f.action, matched: f.matched, maskTag: f.maskTag }));
}
