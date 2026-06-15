const UPSTREAM_URL = process.env.UPSTREAM_URL ?? "http://localhost:8787";
const DB_PATH = process.env.DB_PATH ?? "audit.sqlite";

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

export { UPSTREAM_URL, DB_PATH, SIZE_THRESHOLDS, CHUNK_SIZE, CONTEXT_KEY };
