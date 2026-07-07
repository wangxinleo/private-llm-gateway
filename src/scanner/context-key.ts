import { CONTEXT_KEY, SECRET_SCANNER_MODE } from "@/config";
import type { Finding, FindingCategory } from "@/types";
import { buildMaskTag } from "./mask-tag";

const SECRET_KEYS: ReadonlySet<string> = new Set([
  "apikey",
  "appkey",
  "accesskey",
  "secretaccesskey",
  "awssecretaccesskey",
  "awsaccesskeysecret",
  "awssessiontoken",
  "sessiontoken",
  "secret",
  "secretkey",
  "clientsecret",
  "consumersecret",
  "privatekey",
  "privatekeyid",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "bearertoken",
  "token",
  "logintoken",
  "signintoken",
  "identitytoken",
  "xapikey",
  "xauthtoken",
  "authorization",
  "proxyauthorization",
  "password",
  "passwd",
  "passphrase",
  "pwd",
  "credential",
  "credentials",
  "serviceaccount",
  "serviceaccountkey",
  "accountkey",
  "accountsecret",
  "clientkey",
  "clientkeydata",
  "consumerkey",
  "tunneltoken",
  "cftoken",
  "cloudflaretoken",
  "auth",
  "basicauth",
  "npmauth",
  "npmauthtoken",
  "pypitoken",
  "supabaseservicerolekey",
  "servicerolekey",
  "webhooksecret",
  "signingsecret",
]);

const SECRET_SUFFIXES = [
  "apikey",
  "appkey",
  "accesskey",
  "secretkey",
  "secretaccesskey",
  "clientsecret",
  "consumersecret",
  "privatekey",
  "privatekeyid",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "bearertoken",
  "token",
  "password",
  "passwd",
  "passphrase",
  "credential",
  "credentials",
  "authsecret",
  "authkey",
  "identitytoken",
] as const;

const ENDPOINT_KEYS: ReadonlySet<string> = new Set([
  "baseurl",
  "baseuri",
  "apibaseurl",
  "endpoint",
  "apiendpoint",
  "url",
  "uri",
  "apiurl",
  "server",
  "serverurl",
  "host",
  "hostname",
  "proxy",
  "proxyurl",
  "serviceurl",
  "bashurl",
]);

const ENDPOINT_SUFFIXES = [
  "baseurl",
  "baseuri",
  "endpoint",
  "apiendpoint",
  "apiurl",
  "serverurl",
  "serviceurl",
  "proxyurl",
  "url",
  "uri",
  "host",
  "hostname",
] as const;

const IDENTITY_KEYS: ReadonlySet<string> = new Set([
  "username",
  "userid",
  "uid",
  "memberid",
  "accountid",
  "account",
  "accountname",
  "tenantid",
  "projectid",
  "clientid",
  "clientemail",
  "login",
  "loginid",
  "sessionid",
  "sid",
  "ticket",
  "session",
  "publickey",
  "cookie",
  "setcookie",
]);

const IDENTITY_SUFFIXES = [
  "username",
  "userid",
  "accountid",
  "accountname",
  "tenantid",
  "projectid",
  "clientid",
  "clientemail",
  "sessionid",
] as const;

const ENCODED_KEYS: ReadonlySet<string> = new Set([
  "configb64",
  "configbase64",
  "encodedconfig",
  "secretb64",
  "secretbase64",
  "encodedsecret",
  "credentialsb64",
  "credentialsbase64",
  "encodedcredentials",
  "serviceaccountb64",
  "serviceaccountbase64",
  "kubeconfigb64",
  "kubeconfigbase64",
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

type KeyGroup = "secret" | "endpoint" | "identity" | "encoded" | "unknown";

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
  return key.replace(/^["']|["']$/g, "").toLowerCase().replace(/[_.\-\s]/g, "");
}

function normalizeLastKeySegment(key: string): string {
  const trimmed = key.replace(/^["']|["']$/g, "");
  const parts = trimmed.split(/[.\s]+/).filter(Boolean);
  const last = parts.length > 0 ? parts[parts.length - 1] : trimmed;
  return normalizeKey(last ?? trimmed);
}

function hasAnySuffix(value: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => value.endsWith(suffix));
}

function isSecretKey(normalized: string, lastSegment: string): boolean {
  return SECRET_KEYS.has(normalized)
    || SECRET_KEYS.has(lastSegment)
    || hasAnySuffix(normalized, SECRET_SUFFIXES)
    || hasAnySuffix(lastSegment, SECRET_SUFFIXES);
}

function isEndpointKey(normalized: string, lastSegment: string): boolean {
  return ENDPOINT_KEYS.has(normalized)
    || ENDPOINT_KEYS.has(lastSegment)
    || hasAnySuffix(normalized, ENDPOINT_SUFFIXES)
    || hasAnySuffix(lastSegment, ENDPOINT_SUFFIXES);
}

function isIdentityKey(normalized: string, lastSegment: string): boolean {
  return IDENTITY_KEYS.has(normalized)
    || IDENTITY_KEYS.has(lastSegment)
    || hasAnySuffix(normalized, IDENTITY_SUFFIXES)
    || hasAnySuffix(lastSegment, IDENTITY_SUFFIXES);
}

function isEncodedKey(normalized: string, lastSegment: string): boolean {
  return ENCODED_KEYS.has(normalized) || ENCODED_KEYS.has(lastSegment);
}

function classifyKey(key: string): KeyGroup {
  const normalized = normalizeKey(key);
  const lastSegment = normalizeLastKeySegment(key);

  if (isEncodedKey(normalized, lastSegment)) return "encoded";
  if (isSecretKey(normalized, lastSegment)) return "secret";
  if (isEndpointKey(normalized, lastSegment)) return "endpoint";
  if (isIdentityKey(normalized, lastSegment)) return "identity";
  return "unknown";
}

function stripValue(value: string): string {
  return value.trim().replace(/^["'`]|["'`]$/g, "").replace(/[;,]+$/g, "");
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

function isPlaceholderValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (/^\$\{[a-z0-9_.-]+\}$/i.test(value)) return true;
  if (/^process\.env\.[a-z0-9_.-]+$/i.test(value)) return true;
  if (/^(?:your|my|replace|insert|example|sample|dummy|fake|test|todo)[_-]?(?:api)?[_-]?(?:key|token|secret|password)?$/i.test(value)) return true;
  return ["changeme", "change-me", "redacted", "masked", "placeholder", "undefined", "null", "none"].includes(normalized);
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function hasAllowedSecretChars(value: string): boolean {
  return /^[A-Za-z0-9._=+\-:~!@#$%^*\/]+$/.test(value);
}

function isHighEntropySecretValue(value: string): boolean {
  const minLength = SECRET_SCANNER_MODE === "strict" ? 16 : 32;
  const minEntropy = SECRET_SCANNER_MODE === "strict" ? 3.3 : 4.0;
  return value.length >= minLength && shannonEntropy(value) >= minEntropy;
}

function isSuspiciousSecretValue(value: string): boolean {
  if (!isWithinLengthAndSpaceLimits(value)) return false;
  if (SECRET_SCANNER_MODE !== "strict" && isPlaceholderValue(value)) return false;
  if (!hasAllowedSecretChars(value)) return false;
  if (/^\d+$/.test(value)) return false;

  const hasDigitOrSymbol = /[0-9._=+\-:~!@#$%^*\/]/.test(value);
  if (hasDigitOrSymbol && !/^[A-Za-z]+$/.test(value)) return true;

  return isHighEntropySecretValue(value);
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
      const key = rawKey.replace(/^["']|["']$/g, "");
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

function decodeBase64Value(value: string): string | null {
  const stripped = stripValue(value);
  if (stripped.length < 16 || stripped.length > CONTEXT_KEY.MAX_LENGTH) return null;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(stripped)) return null;

  const normalized = stripped.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  try {
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    if (decoded.length < 8) return null;
    const printableChars = [...decoded].filter((char) => char === "\n" || char === "\r" || char === "\t" || (char >= " " && char <= "~")).length;
    if (printableChars / decoded.length < 0.85) return null;
    return decoded;
  } catch {
    return null;
  }
}

function decodedTextLooksSensitive(decoded: string): boolean {
  if (/-----BEGIN\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+)?PRIVATE\s+KEY-----/.test(decoded)) return true;
  if (/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(decoded)) return true;

  let hasSecret = false;
  let hasEndpoint = false;
  for (const candidate of extractCandidates(decoded)) {
    const group = classifyKey(candidate.key);
    if (group === "secret" && isSuspiciousSecretValue(candidate.value)) hasSecret = true;
    if (group === "endpoint" && isEndpointValue(candidate.value)) hasEndpoint = true;
  }

  return hasSecret || (hasSecret && hasEndpoint);
}

function isSensitiveEncodedValue(value: string): boolean {
  const decoded = decodeBase64Value(value);
  return decoded !== null && decodedTextLooksSensitive(decoded);
}

function toFinding(value: string, category: FindingCategory = "CONTEXTUAL_SECRET"): Finding {
  return {
    category,
    action: "mask",
    matched: value,
    maskTag: buildMaskTag(category),
  };
}

export function scanContextKey(text: string): Finding[] {
  const secretHits: Finding[] = [];
  const endpointHits: Finding[] = [];
  const identityHits: Finding[] = [];
  const encodedHits: Finding[] = [];
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
    } else if (group === "encoded" && isSensitiveEncodedValue(candidate.value)) {
      if (!seenValues.has(candidate.value)) {
        seenValues.add(candidate.value);
        encodedHits.push(toFinding(candidate.value, "ENCODED_SECRET"));
      }
    }
  }

  if (hasSecretCandidate) {
    return [...secretHits, ...endpointHits, ...identityHits, ...encodedHits];
  }

  return [...endpointHits, ...encodedHits];
}
