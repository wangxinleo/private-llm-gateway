const UPSTREAM_URL = process.env.UPSTREAM_URL ?? "http://localhost:8787";
const DB_PATH = process.env.DB_PATH ?? "audit.sqlite";
const DEBUG = process.env.DEBUG === "true" || process.env.NODE_ENV !== "production";

const SIZE_THRESHOLDS = {
  FULL_SCAN: 128 * 1024,
  CHUNKED_SCAN: 1024 * 1024,
} as const;

const CHUNK_SIZE = 64 * 1024;

const CONTEXT_KEY = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 200,
  ALLOWED_CHARSET: /^[A-Za-z0-9._=-]+$/,
  MAX_SPACES: 2,
} as const;

const PRIVACY_MASK_FORMAT = (process.env.PRIVACY_MASK_FORMAT ?? "explicit") as "legacy" | "explicit";
const PRIVACY_DISAMBIGUATION_MODE = (process.env.PRIVACY_DISAMBIGUATION_MODE ?? "auto") as "off" | "prefix" | "json-meta" | "auto";
const PRIVACY_NOTICE_TEXT = process.env.PRIVACY_NOTICE_TEXT ?? "Tokens like <<PRIVACY_MASK:EMAIL>> were inserted by the privacy proxy and are not original source text.";
const PRIVACY_DEBUG_HEADERS = process.env.PRIVACY_DEBUG_HEADERS === "true";

export { UPSTREAM_URL, DB_PATH, DEBUG, SIZE_THRESHOLDS, CHUNK_SIZE, CONTEXT_KEY, PRIVACY_MASK_FORMAT, PRIVACY_DISAMBIGUATION_MODE, PRIVACY_NOTICE_TEXT, PRIVACY_DEBUG_HEADERS };
