import { CONTEXT_KEY } from "@/config";
import type { Finding } from "@/types";
import { buildMaskTag } from "./mask-tag";

// Solo-trigger: value masked unconditionally when key matches
const SECRET_KEYS: ReadonlySet<string> = new Set([
  "api_key",
  "apikey",
  "app_key",
  "access_key",
  "secret",
  "secret_key",
  "client_secret",
  "consumer_secret",
  "private_key",
  "access_token",
  "refresh_token",
  "id_token",
  "auth_token",
  "bearer_token",
  "login_token",
  "signin_token",
  "x-api-key",
  "x-auth-token",
  "proxy-authorization",
  "authorization",
  "password",
  "passwd",
  "passphrase",
  "credential",
  "credentials",
  "service_account",
  "service-account",
  "account_key",
  "account_secret",
  "accesskey",
  "secretkey",
  "clientsecret",
  "client_key",
  "consumer_key",
]);

// Pair-trigger: masked only when a SECRET_KEYS hit exists in the same text
const IDENTITY_KEYS: ReadonlySet<string> = new Set([
  "username",
  "user_id",
  "userid",
  "uid",
  "member_id",
  "account_id",
  "accountid",
  "account",
  "login",
  "login_id",
  "loginid",
  "session_id",
  "sessionid",
  "sid",
  "ticket",
  "token",
  "session",
  "public_key",
  "cookie",
  "set-cookie",
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
  { name: "DOT", pattern: /\.(\w+)\s*[:=]\s*["']?([^\s"'&]+)["']?/g },
];

function isSuspiciousValue(value: string): boolean {
  if (value.length < CONTEXT_KEY.MIN_LENGTH) return false;
  if (value.length > CONTEXT_KEY.MAX_LENGTH) return false;
  if (!CONTEXT_KEY.ALLOWED_CHARSET.test(value)) return false;
  if (/^[A-Za-z]+$/.test(value)) return false;
  if (/^\d+$/.test(value)) return false;
  if (!/[0-9._=-]/.test(value)) return false;
  const spaces = (value.match(/ /g) ?? []).length;
  if (spaces > CONTEXT_KEY.MAX_SPACES) return false;
  return true;
}

export function scanContextKey(text: string): Finding[] {
  const secretHits: Finding[] = [];
  const identityHits: Finding[] = [];
  const seen = new Set<string>();

  for (const { pattern } of KEY_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const key = match[1]?.toLowerCase() ?? "";
      const value = match[2] ?? "";

      if (!isSuspiciousValue(value) || seen.has(value)) continue;

      if (SECRET_KEYS.has(key)) {
        seen.add(value);
        secretHits.push({
          category: "CONTEXTUAL_SECRET",
          action: "mask",
          matched: value,
          maskTag: buildMaskTag("CONTEXTUAL_SECRET"),
        });
      } else if (IDENTITY_KEYS.has(key)) {
        seen.add(value);
        identityHits.push({
          category: "CONTEXTUAL_SECRET",
          action: "mask",
          matched: value,
          maskTag: buildMaskTag("CONTEXTUAL_SECRET"),
        });
      }
    }
  }

  if (secretHits.length > 0) {
    return [...secretHits, ...identityHits];
  }
  return secretHits;
}
