import { CONTEXT_KEY } from "@/config";
import type { Finding } from "@/types";
import { buildMaskTag } from "./mask-tag";

const SECRET_KEYS: ReadonlySet<string> = new Set([
  "apikey",
  "appkey",
  "accesskey",
  "secret",
  "secretkey",
  "clientsecret",
  "consumersecret",
  "privatekey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "bearertoken",
  "logintoken",
  "signintoken",
  "xapikey",
  "xauthtoken",
  "proxyauthorization",
  "authorization",
  "password",
  "passwd",
  "passphrase",
  "credential",
  "credentials",
  "serviceaccount",
  "accountkey",
  "accountsecret",
  "clientkey",
  "consumerkey",
  "tunneltoken",
  "cftoken",
  "cloudflaretoken",
]);

const ENDPOINT_KEYS: ReadonlySet<string> = new Set([
  "baseurl",
  "apibaseurl",
  "endpoint",
  "apiendpoint",
  "url",
  "apiurl",
  "serverurl",
  "host",
  "bashurl",
]);

const IDENTITY_KEYS: ReadonlySet<string> = new Set([
  "username",
  "userid",
  "uid",
  "memberid",
  "accountid",
  "account",
  "login",
  "loginid",
  "sessionid",
  "sid",
  "ticket",
  "token",
  "session",
  "publickey",
  "cookie",
  "setcookie",
]);

interface KeyPattern {
  name: string;
  pattern: RegExp;
  valueGroup: number;
}

interface Candidate {
  key: string;
  value: string;
}

type KeyGroup = "secret" | "endpoint" | "identity" | "unknown";

const KEY_PATTERNS: KeyPattern[] = [
  { name: "QUOTED_KV", pattern: /["']?([A-Za-z0-9_.-]+)["']?\s*[:=]\s*(["'])([^"'\r\n]+)\2/g, valueGroup: 3 },
  { name: "BARE_KV", pattern: /(?:^|[?&\s,{])(["']?[A-Za-z0-9_.-]+["']?)\s*[:=]\s*([^\s"',}\]]+)/g, valueGroup: 2 },
  { name: "QUERY_PARAM", pattern: /[?&]([A-Za-z0-9_.-]+)=([^&\s"',}\]]+)/g, valueGroup: 2 },
  { name: "BRACKET", pattern: /([A-Za-z0-9_.-]+)\s*\[\s*["']?([^"'\]]+)["']?\s*\]/g, valueGroup: 2 },
  { name: "DICT_ACCESS", pattern: /\[\s*["']([A-Za-z0-9_.-]+)["']\s*\]\s*[:=]\s*["']?([^\s"'&]+)["']?/g, valueGroup: 2 },
  { name: "XML", pattern: /<([A-Za-z0-9_.-]+)>([^<]+)<\/\1>/g, valueGroup: 2 },
  { name: "DOT", pattern: /\.([A-Za-z0-9_.-]+)\s*[:=]\s*["']?([^\s"'&]+)["']?/g, valueGroup: 2 },
];

function normalizeKey(key: string): string {
  return key.replace(/^['"]|['"]$/g, "").toLowerCase().replace(/[_.\-\s]/g, "");
}

function normalizeLastKeySegment(key: string): string {
  const trimmed = key.replace(/^['"]|['"]$/g, "");
  const parts = trimmed.split(/[.\s]+/).filter(Boolean);
  const last = parts.length > 0 ? parts[parts.length - 1] : trimmed;
  return normalizeKey(last ?? trimmed);
}

function classifyKey(key: string): KeyGroup {
  const normalized = normalizeKey(key);
  const lastSegment = normalizeLastKeySegment(key);

  if (SECRET_KEYS.has(normalized) || SECRET_KEYS.has(lastSegment)) return "secret";
  if (ENDPOINT_KEYS.has(normalized) || ENDPOINT_KEYS.has(lastSegment)) return "endpoint";
  if (IDENTITY_KEYS.has(normalized) || IDENTITY_KEYS.has(lastSegment)) return "identity";
  return "unknown";
}

function stripValue(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "").replace(/[;,]+$/g, "");
}

function tokenValue(value: string): string {
  return stripValue(value).split(/[&;]/, 1)[0] ?? "";
}

function isWithinLengthAndSpaceLimits(value: string): boolean {
  if (value.length < CONTEXT_KEY.MIN_LENGTH) return false;
  if (value.length > CONTEXT_KEY.MAX_LENGTH) return false;
  const spaces = (value.match(/ /g) ?? []).length;
  return spaces <= CONTEXT_KEY.MAX_SPACES;
}

function isSuspiciousSecretValue(value: string): boolean {
  if (!isWithinLengthAndSpaceLimits(value)) return false;
  if (!/^[A-Za-z0-9._=+\-:~!@#$%^*\/]+$/.test(value)) return false;
  if (/^[A-Za-z]+$/.test(value)) return false;
  if (/^\d+$/.test(value)) return false;
  if (!/[0-9._=+\-:~!@#$%^*\/]/.test(value)) return false;
  return true;
}

function hasEndpointHostShape(value: string): boolean {
  const hostWithOptionalPath = /^[A-Za-z0-9.-]+(?::\d{2,5})?(?:[/?#][^\s]*)?$/;
  if (!hostWithOptionalPath.test(value)) return false;
  return value.includes(".") || value.startsWith("localhost") || /:\d{2,5}/.test(value);
}

function isEndpointValue(value: string): boolean {
  if (!isWithinLengthAndSpaceLimits(value)) return false;
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) && !hasEndpointHostShape(value)) {
    return false;
  }

  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    return parsed.hostname.length > 0 && !/^\d+$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

function extractCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const { pattern, valueGroup } of KEY_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const rawKey = match[1] ?? "";
      const rawValue = match[valueGroup] ?? "";
      const key = rawKey.replace(/^['"]|['"]$/g, "");
      const group = classifyKey(key);
      const value = group === "endpoint" ? stripValue(rawValue) : tokenValue(rawValue);
      const dedupeKey = `${normalizeKey(key)}\0${value}`;

      if (!key || !value || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      candidates.push({ key, value });
    }
  }

  return candidates;
}

function toFinding(value: string): Finding {
  return {
    category: "CONTEXTUAL_SECRET",
    action: "mask",
    matched: value,
    maskTag: buildMaskTag("CONTEXTUAL_SECRET"),
  };
}

export function scanContextKey(text: string): Finding[] {
  const secretHits: Finding[] = [];
  const endpointHits: Finding[] = [];
  const identityHits: Finding[] = [];
  const seenValues = new Set<string>();
  let hasSecretCandidate = false;

  for (const candidate of extractCandidates(text)) {
    const group = classifyKey(candidate.key);

    if (group === "secret" && isSuspiciousSecretValue(candidate.value)) {
      hasSecretCandidate = true;
      if (!seenValues.has(candidate.value)) {
        seenValues.add(candidate.value);
        secretHits.push(toFinding(candidate.value));
      }
    } else if (group === "endpoint" && isEndpointValue(candidate.value)) {
      if (!seenValues.has(candidate.value)) {
        seenValues.add(candidate.value);
        endpointHits.push(toFinding(candidate.value));
      }
    } else if (group === "identity" && isSuspiciousSecretValue(candidate.value)) {
      if (!seenValues.has(candidate.value)) {
        seenValues.add(candidate.value);
        identityHits.push(toFinding(candidate.value));
      }
    }
  }

  if (hasSecretCandidate) {
    return [...secretHits, ...endpointHits, ...identityHits];
  }

  return endpointHits;
}
