import { CONTEXT_KEY } from "@/config";
import type { Finding } from "@/types";

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
]);

const KEY_PATTERN = /["']?(\w+)["']?\s*[:=]\s*["']?([^\s"']+)["']?/g;

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
  let match: RegExpExecArray | null;

  KEY_PATTERN.lastIndex = 0;
  while ((match = KEY_PATTERN.exec(text)) !== null) {
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
        maskTag: "[CONTEXTUAL_SECRET]",
      });
    }
  }

  return findings;
}
