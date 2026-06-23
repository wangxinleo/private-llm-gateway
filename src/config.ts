const UPSTREAM_URL = process.env.UPSTREAM_URL ?? "http://localhost:8787";
const DB_PATH = process.env.DB_PATH ?? "audit.sqlite";
const DEBUG = process.env.DEBUG === "true" || process.env.NODE_ENV !== "production";

// Default values for hot-reloadable configs
export const DEFAULT_CONFIG_VALUES = {
  SIZE_THRESHOLD_FULL_SCAN: 128 * 1024,
  SIZE_THRESHOLD_CHUNKED_SCAN: 1024 * 1024,
  CHUNK_SIZE: 64 * 1024,
  CONTEXT_KEY_MIN_LENGTH: 8,
  CONTEXT_KEY_MAX_LENGTH: 200,
  CONTEXT_KEY_MAX_SPACES: 2,
  PATH_PREFIX_OPTIONS: ["/api/v1/messages", "/api/v1/responses", "/api/v1beta"],
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

const PRIVACY_MASK_FORMAT = (process.env.PRIVACY_MASK_FORMAT ?? "explicit") as "legacy" | "explicit";
const PRIVACY_DISAMBIGUATION_MODE = (process.env.PRIVACY_DISAMBIGUATION_MODE ?? "auto") as "off" | "prefix" | "json-meta" | "auto";
const PRIVACY_NOTICE_TEXT = process.env.PRIVACY_NOTICE_TEXT ?? "Tokens like <<PRIVACY_MASK:EMAIL>> were inserted by the privacy proxy and are not original source text.";
const PRIVACY_DEBUG_HEADERS = process.env.PRIVACY_DEBUG_HEADERS === "true";

export { UPSTREAM_URL, DB_PATH, DEBUG, PRIVACY_MASK_FORMAT, PRIVACY_DISAMBIGUATION_MODE, PRIVACY_NOTICE_TEXT, PRIVACY_DEBUG_HEADERS };
