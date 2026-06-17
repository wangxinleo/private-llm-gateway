import type { Finding } from "@/types";
import { buildMaskTag } from "./mask-tag";
import { Logger } from "@/log";

const log = new Logger("scanner");

const PRIVATE_KEY_RE =
  /-----BEGIN\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+)?PRIVATE\s+KEY-----/;

const BEARER_TOKEN_RE = /Bearer\s+[A-Za-z0-9._~-]+/i;
const BASIC_AUTH_RE = /Basic\s+[A-Za-z0-9+/]+=*/i;

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

const COOKIE_HEADER_RE = /(?<![\w-])Cookie:\s*\S+/i;
const SET_COOKIE_HEADER_RE = /Set-Cookie:\s*\S+/i;

const DB_URI_RE =
  /(?:postgres|mysql|mongodb|redis):\/\/[^\s@]+:[^\s@]+@[^\s]+/i;

const AWS_KEY_RE = /(?:AKIA|ASIA)[0-9A-Z]{16}/;
const GITHUB_TOKEN_RE = /(?:ghp_|github_pat_)[A-Za-z0-9_]{36,}/;
const SLACK_TOKEN_RE = /xox[bp]-[A-Za-z0-9-]+/;
const GOOGLE_API_KEY_RE = /AIza[A-Za-z0-9_-]{35}/;

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
];

export function scanSecrets(text: string): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const rule of STRONG_RULES) {
    rule.pattern.lastIndex = 0;
    const match = rule.pattern.exec(text);
    if (match) {
      const matched = match[0];
      if (!seen.has(matched)) {
        log.debug(`HIT: ${rule.category} | matched ${matched.length} chars`);
        seen.add(matched);
        findings.push({
          category: rule.category,
          action: "mask",
          matched,
          maskTag: buildMaskTag(rule.category),
        });
      }
    }
  }
  log.debug(`secrets scan complete | findings: ${findings.length} | categories: [${findings.map(f => f.category).join(", ")}]`);
  return findings;
}
