import { CONTEXT_KEY } from "@/config";
import type { Finding } from "@/types";
import { buildMaskTag } from "./mask-tag";

const HIGH_RISK_KEYWORDS: ReadonlySet<string> = new Set([
  "key",
  "api_key",
  "apikey",
  "app_key",
  "access_key",
  "secret",
  "secret_key",
  "client_key",
  "client_secret",
  "consumer_key",
  "consumer_secret",
  "private_key",
  "public_key",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "auth_token",
  "bearer_token",
  "session",
  "session_id",
  "sessionid",
  "sid",
  "ticket",
  "authorization",
  "auth",
  "credential",
  "credentials",
  "passwd",
  "password",
  "passphrase",
  "login_token",
  "signin_token",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "proxy-authorization",
  "service_account",
  "service-account",
  "account_key",
  "account_secret",
  "accesskey",
  "secretkey",
  "clientid",
  "clientsecret",
  "username",
  "user",
  "userid",
  "user_id",
  "login",
  "loginid",
  "login_id",
  "email",
  "account",
  "account_id",
  "accountid",
  "uid",
  "member_id",
]);

interface KeyPattern {
  name: string;
  pattern: RegExp;
}

const KEY_PATTERNS: KeyPattern[] = [
  { name: "KV", pattern: /["']?(\w+)["']?\s*[:=]\s*["']?([^\s"'&]+)["']?/g },
  { name: "BRACKET", pattern: /(\w+)\s*\[\s*["']?([^"'\]]+)["']?\s*\]/g },
  { name: "DICT_ACCESS", pattern: /\[\s*["'](\w+)["']\s*\]\s*[:=]\s*["']?([^\s"'&]+)["']?/g },
  { name: "XML", pattern: /<(\w+)>([^<]+)<\/\1>/g },
  { name: "NEWLINE", pattern: /(\w+)\s*\n\s*([^\n]+)/g },
  { name: "DOT", pattern: /\.(\w+)\s*[.:]\s*["']?([^\s"'&]+)["']?/g },
];

function isSuspiciousValue(value: string): boolean {
  if (value.length < CONTEXT_KEY.MIN_LENGTH) return false;
  if (value.length > CONTEXT_KEY.MAX_LENGTH) return false;
  if (!CONTEXT_KEY.ALLOWED_CHARSET.test(value)) return false;
  const spaces = (value.match(/ /g) ?? []).length;
  if (spaces > CONTEXT_KEY.MAX_SPACES) return false;
  return true;
}

export function scanContextKey(text: string): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const { pattern } of KEY_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const key = match[1]?.toLowerCase() ?? "";
      const value = match[2] ?? "";

      if (
        HIGH_RISK_KEYWORDS.has(key) &&
        isSuspiciousValue(value) &&
        !seen.has(value)
      ) {
        seen.add(value);
        findings.push({
          category: "CONTEXTUAL_SECRET",
          action: "mask",
          matched: value,
          maskTag: buildMaskTag("CONTEXTUAL_SECRET"),
        });
      }
    }
  }

  return findings;
}
