import type { HighRiskAssets } from "@/types";

export type { HighRiskAssets } from "@/types";

const UPSTREAM_URL = process.env.UPSTREAM_URL ?? "http://localhost:8787";
const DB_PATH = process.env.DB_PATH ?? "audit.sqlite";
const DEBUG = process.env.DEBUG === "true" || process.env.NODE_ENV !== "production";
const SECRET_SCANNER_MODE = process.env.PRIVACY_SECRET_SCANNER_MODE === "strict" ? "strict" : "balanced";

export const DEFAULT_HIGH_RISK_ASSETS: HighRiskAssets = {
  domains: ["*.ccload.com", "*.gffunds.com"],
  emails: [],
  accounts: [],
};

// Default values for hot-reloadable configs
export const DEFAULT_CONFIG_VALUES = {
  CONTEXT_KEY_MIN_LENGTH: 8,
  CONTEXT_KEY_MAX_LENGTH: 200,
  CONTEXT_KEY_MAX_SPACES: 2,
  CONTEXT_WINDOW_SIZE: 200,
  PATH_PREFIX_OPTIONS: ["/v1/messages", "/v1/responses", "/v1beta"],
  HIGH_RISK_ASSETS: DEFAULT_HIGH_RISK_ASSETS,
};

// Hot-reloadable config state (wrapped in objects to allow mutation)
export const CONTEXT_KEY = {
  MIN_LENGTH: DEFAULT_CONFIG_VALUES.CONTEXT_KEY_MIN_LENGTH,
  MAX_LENGTH: DEFAULT_CONFIG_VALUES.CONTEXT_KEY_MAX_LENGTH,
  ALLOWED_CHARSET: /^[A-Za-z0-9._=-]+$/,
  MAX_SPACES: DEFAULT_CONFIG_VALUES.CONTEXT_KEY_MAX_SPACES,
};

export const CONTEXT_WINDOW_SIZE = { value: DEFAULT_CONFIG_VALUES.CONTEXT_WINDOW_SIZE };

export const PATH_PREFIX_OPTIONS: string[] = [...DEFAULT_CONFIG_VALUES.PATH_PREFIX_OPTIONS];

export const HIGH_RISK_ASSETS: HighRiskAssets = {
  domains: [...DEFAULT_HIGH_RISK_ASSETS.domains],
  emails: [],
  accounts: [],
};

const PRIVACY_MASK_FORMAT = process.env.PRIVACY_MASK_FORMAT === "legacy" ? "legacy" : "semantic";
export type PrivacyDisambiguationMode = "off" | "auto";

function resolveDisambiguationMode(raw: string | undefined): PrivacyDisambiguationMode {
  // v3 收敛为 auto|off;旧值 prefix/json-meta 归一为 auto(前缀污染与自定义字段已废弃)
  if (raw === "off") return "off";
  return "auto";
}

const PRIVACY_DISAMBIGUATION_MODE = resolveDisambiguationMode(process.env.PRIVACY_DISAMBIGUATION_MODE);
const PRIVACY_NOTICE_TEXT = process.env.PRIVACY_NOTICE_TEXT ??
  `Anonymized placeholders like {{EMAIL_trwmq}} or <<PRIVACY_MASK:EMAIL>> were injected by a privacy proxy: never invent, guess, expand, rewrite, translate, or remove them; keep every placeholder exactly as-is where the original value belongs.`;
const PRIVACY_DEBUG_HEADERS = process.env.PRIVACY_DEBUG_HEADERS === "true";

export { UPSTREAM_URL, DB_PATH, DEBUG, SECRET_SCANNER_MODE, PRIVACY_MASK_FORMAT, PRIVACY_DISAMBIGUATION_MODE, PRIVACY_NOTICE_TEXT, PRIVACY_DEBUG_HEADERS };
