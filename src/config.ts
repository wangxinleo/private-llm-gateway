import type { ExclusionRule } from "@/types";

export type { ExclusionRule } from "@/types";

const UPSTREAM_URL = process.env.UPSTREAM_URL ?? "http://localhost:8787";
const DB_PATH = process.env.DB_PATH ?? "audit.sqlite";
const DEBUG = process.env.DEBUG === "true" || process.env.NODE_ENV !== "production";
const SECRET_SCANNER_MODE = process.env.PRIVACY_SECRET_SCANNER_MODE === "strict" ? "strict" : "balanced";

// Default values for hot-reloadable configs
export const DEFAULT_CONFIG_VALUES = {
  SIZE_THRESHOLD_FULL_SCAN: 128 * 1024,
  SIZE_THRESHOLD_CHUNKED_SCAN: 1024 * 1024,
  CHUNK_SIZE: 64 * 1024,
  CONTEXT_KEY_MIN_LENGTH: 8,
  CONTEXT_KEY_MAX_LENGTH: 200,
  CONTEXT_KEY_MAX_SPACES: 2,
  PATH_PREFIX_OPTIONS: ["/v1/messages", "/v1/responses", "/v1beta"],
  SCANNER_EXCLUSIONS: [
    { category: "EMAIL", mode: "exact", value: "n@router.post" },
    { category: "BASIC_AUTH", mode: "regex", value: "^[Bb]asic\\s+(info|searches|details?|basic)$" },
    { category: "BEARER_TOKEN", mode: "exact", value: "Bearer token" },
  ] as ExclusionRule[],
};

// Hot-reloadable config state (wrapped in objects to allow mutation)
export const SIZE_THRESHOLDS = {
  FULL_SCAN: DEFAULT_CONFIG_VALUES.SIZE_THRESHOLD_FULL_SCAN,
  CHUNKED_SCAN: DEFAULT_CONFIG_VALUES.SIZE_THRESHOLD_CHUNKED_SCAN,
};

export const CONFIG_STATE = {
  CHUNK_SIZE: DEFAULT_CONFIG_VALUES.CHUNK_SIZE,
};

export const CONTEXT_KEY = {
  MIN_LENGTH: DEFAULT_CONFIG_VALUES.CONTEXT_KEY_MIN_LENGTH,
  MAX_LENGTH: DEFAULT_CONFIG_VALUES.CONTEXT_KEY_MAX_LENGTH,
  ALLOWED_CHARSET: /^[A-Za-z0-9._=-]+$/,
  MAX_SPACES: DEFAULT_CONFIG_VALUES.CONTEXT_KEY_MAX_SPACES,
};

export const PATH_PREFIX_OPTIONS: string[] = [...DEFAULT_CONFIG_VALUES.PATH_PREFIX_OPTIONS];

export const SCANNER_EXCLUSIONS: ExclusionRule[] = [];
export const DEFAULT_EXCLUSION_RULES: ExclusionRule[] = [...DEFAULT_CONFIG_VALUES.SCANNER_EXCLUSIONS];

const PRIVACY_MASK_FORMAT = (process.env.PRIVACY_MASK_FORMAT ?? "explicit") as "legacy" | "explicit";
export type PrivacyDisambiguationMode = "off" | "prefix" | "auto";

function resolveDisambiguationMode(raw: string | undefined): PrivacyDisambiguationMode {
  // legacy "json-meta" used to inject custom top-level fields; map it to safe prompt injection.
  if (raw === "off" || raw === "prefix" || raw === "auto") return raw;
  if (raw === "json-meta") return "auto";
  return "auto";
}

const PRIVACY_DISAMBIGUATION_MODE = resolveDisambiguationMode(process.env.PRIVACY_DISAMBIGUATION_MODE);
const PRIVACY_NOTICE_TEXT = process.env.PRIVACY_NOTICE_TEXT ??
  `Tokens like <<PRIVACY_MASK:EMAIL>> were inserted by the privacy proxy and are not original source text.\n` +
  `When file content contains <<PRIVACY_MASK:xxx>> tokens:\n` +
  `- These tokens replaced hidden original content and may represent one or multiple original lines.\n` +
  `- Do not modify masked tokens or the original content they represent.\n` +
  `- Do not rely on line numbers after a masked token; line numbers may no longer match the original file.\n` +
  `- Only perform automatic edits when you can anchor the change to exact, unmasked surrounding text that is visible in the current file.\n` +
  `- Do not rewrite entire files that contain masked tokens.\n` +
  `- If a required change touches a masked region, depends on exact line numbers after a masked region, or cannot be anchored to visible unmasked text, output a "Manual Modification Guide" with the file path, approximate location, intended change, and reason.`;
const PRIVACY_DEBUG_HEADERS = process.env.PRIVACY_DEBUG_HEADERS === "true";

export { UPSTREAM_URL, DB_PATH, DEBUG, SECRET_SCANNER_MODE, PRIVACY_MASK_FORMAT, PRIVACY_DISAMBIGUATION_MODE, PRIVACY_NOTICE_TEXT, PRIVACY_DEBUG_HEADERS };
