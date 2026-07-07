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
  /(?:postgres|mysql|mongodb|redis):\/\/[^\s@]+:[^\s@]+@[^\s'"<>]+/gi;
const URL_CREDENTIAL_RE =
  /\b(?!(?:postgres|mysql|mongodb|redis):\/\/)[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:/@?#]+:[^\s@]+@[^\s'"<>]+/gi;
const JDBC_CREDENTIAL_RE = /\bjdbc:[^\s'"<>]*(?:[?;&](?:user|username)=[^\s'"<>&;]+)[^\s'"<>]*(?:[?;&](?:password|passwd|pwd)=[^\s'"<>&;]+)/gi;
const CONNECTION_PASSWORD_PARAM_RE = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s'"<>]+[?&](?:password|passwd|pwd|access_token|authToken)=[^\s'"<>&]+/gi;

const AWS_KEY_RE = /(?:AKIA|ASIA)[0-9A-Z]{16}/g;
const GITHUB_TOKEN_RE = /(?:gh[opusra]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,})/g;
const SLACK_TOKEN_RE = /xox[baprs]-[A-Za-z0-9-]+/g;
const GOOGLE_API_KEY_RE = /AIza[A-Za-z0-9_-]{35}/g;

const OPENAI_KEY_RE = /\bsk-(?:(?:proj|svcacct|admin)-)?[A-Za-z0-9_-]{20,}\b/g;
const ANTHROPIC_KEY_RE = /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g;
const HUGGINGFACE_TOKEN_RE = /\bhf_[A-Za-z0-9]{20,}\b/g;
const REPLICATE_TOKEN_RE = /\br8_[A-Za-z0-9]{24,}\b/g;
const GROQ_TOKEN_RE = /\bgsk_[A-Za-z0-9]{20,}\b/g;
const OPENROUTER_TOKEN_RE = /\bsk-or-v1-[A-Za-z0-9_-]{20,}\b/g;
const PERPLEXITY_TOKEN_RE = /\bpplx-[A-Za-z0-9_-]{20,}\b/g;

const GITLAB_TOKEN_RE = /\b(?:glpat|glrt|glcbt|glagent)-[A-Za-z0-9_-]{16,}\b/g;
const NPM_TOKEN_RE = /\bnpm_[A-Za-z0-9]{20,}\b/g;
const PYPI_TOKEN_RE = /\bpypi-[A-Za-z0-9_.-]{40,}\b/g;
const VERCEL_TOKEN_RE = /\bvercel_[A-Za-z0-9]{20,}\b/g;
const LINEAR_TOKEN_RE = /\blin_api_[A-Za-z0-9]{20,}\b/g;

const AZURE_STORAGE_CONNECTION_RE = /\bDefaultEndpointsProtocol=https?;AccountName=[^;\s]+;AccountKey=[A-Za-z0-9+/=]{20,}(?:;EndpointSuffix=[^;\s]+)?/gi;
const NETRC_CREDENTIAL_RE = /\bmachine\s+\S+\s+login\s+\S+\s+password\s+\S+/gi;
const CURL_USER_CREDENTIAL_RE = /(?<!\S)(?:-u|--user|--proxy-user)\s+[^\s:'"]+:[^\s'"]+/gi;

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
  { category: "CONNECTION_STRING", pattern: URL_CREDENTIAL_RE },
  { category: "CONNECTION_STRING", pattern: JDBC_CREDENTIAL_RE },
  { category: "CONNECTION_STRING", pattern: CONNECTION_PASSWORD_PARAM_RE },
  { category: "CONNECTION_STRING", pattern: AZURE_STORAGE_CONNECTION_RE },
  { category: "AWS_ACCESS_KEY", pattern: AWS_KEY_RE },
  { category: "GITHUB_TOKEN", pattern: GITHUB_TOKEN_RE },
  { category: "DEVELOPER_TOKEN", pattern: GITLAB_TOKEN_RE },
  { category: "DEVELOPER_TOKEN", pattern: NPM_TOKEN_RE },
  { category: "DEVELOPER_TOKEN", pattern: PYPI_TOKEN_RE },
  { category: "DEVELOPER_TOKEN", pattern: VERCEL_TOKEN_RE },
  { category: "DEVELOPER_TOKEN", pattern: LINEAR_TOKEN_RE },
  { category: "SLACK_TOKEN", pattern: SLACK_TOKEN_RE },
  { category: "GOOGLE_API_KEY", pattern: GOOGLE_API_KEY_RE },
  { category: "PROVIDER_API_KEY", pattern: OPENROUTER_TOKEN_RE },
  { category: "PROVIDER_API_KEY", pattern: OPENAI_KEY_RE },
  { category: "PROVIDER_API_KEY", pattern: ANTHROPIC_KEY_RE },
  { category: "PROVIDER_API_KEY", pattern: HUGGINGFACE_TOKEN_RE },
  { category: "PROVIDER_API_KEY", pattern: REPLICATE_TOKEN_RE },
  { category: "PROVIDER_API_KEY", pattern: GROQ_TOKEN_RE },
  { category: "PROVIDER_API_KEY", pattern: PERPLEXITY_TOKEN_RE },
  { category: "CLOUD_CREDENTIAL", pattern: NETRC_CREDENTIAL_RE },
  { category: "CLOUD_CREDENTIAL", pattern: CURL_USER_CREDENTIAL_RE },
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

function collectRuleFindings(rule: Rule, text: string, seen: Set<string>): IndexedFinding[] {
  const findings: IndexedFinding[] = [];
  rule.pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = rule.pattern.exec(text)) !== null) {
    const matched = match[0];
    const dedupeKey = `${rule.category}:${match.index}`;
    if (!seen.has(dedupeKey)) {
      log.debug(`HIT: ${rule.category} | matched ${matched.length} chars`);
      seen.add(dedupeKey);
      findings.push({
        category: rule.category,
        action: "mask",
        matched,
        maskTag: buildMaskTag(rule.category),
        start: match.index,
        end: match.index + matched.length,
      });
    }

    if (matched.length === 0) {
      rule.pattern.lastIndex += 1;
    }
  }
  return findings;
}

function pruneContainedBase64JwtFindings(indexed: IndexedFinding[]): IndexedFinding[] {
  const jwtRanges = indexed.filter((f) => f.category === "JWT");
  if (jwtRanges.length === 0) return indexed;

  return indexed.filter((f) => {
    if (f.category !== "BASE64_TOKEN") return true;
    return !jwtRanges.some((jwt) => f.start >= jwt.start && f.end <= jwt.end);
  });
}

function pruneOverlappingSameCategoryFindings(indexed: IndexedFinding[]): IndexedFinding[] {
  const sorted = [...indexed].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
  });
  const kept: IndexedFinding[] = [];

  for (const candidate of sorted) {
    const overlapsSameCategory = kept.some((existing) => {
      if (existing.category !== candidate.category) return false;
      return candidate.start < existing.end && existing.start < candidate.end;
    });
    if (!overlapsSameCategory) kept.push(candidate);
  }

  return kept.sort((a, b) => a.start - b.start);
}

export function scanSecrets(text: string): Finding[] {
  const seen = new Set<string>();
  const indexed = STRONG_RULES.flatMap((rule) => collectRuleFindings(rule, text, seen));
  const pruned = pruneContainedBase64JwtFindings(pruneOverlappingSameCategoryFindings(indexed));

  log.debug(`secrets scan complete | findings: ${pruned.length} | categories: [${pruned.map((f) => f.category).join(", ")}]`);
  return pruned.map((f) => ({ category: f.category, action: f.action, matched: f.matched, maskTag: f.maskTag }));
}
