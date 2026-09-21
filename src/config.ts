import type { FindingCategory, Severity } from "@/types";

const DB_PATH = process.env.DB_PATH ?? "audit.sqlite";
const DEBUG = process.env.DEBUG === "true" || process.env.NODE_ENV !== "production";
const SECRET_SCANNER_MODE = process.env.PRIVACY_SECRET_SCANNER_MODE === "strict" ? "strict" : "balanced";

// 内置规则默认启停:对齐 maskit 预设(IP_INTERNAL/IPV6_PRIVATE/USCC/MAC/HKID 默认关,防误报)
export const DEFAULT_RULE_TOGGLES: Record<FindingCategory, boolean> = {
  PRIVATE_KEY: true,
  BEARER_TOKEN: true,
  BASIC_AUTH: true,
  JWT: true,
  COOKIE_HEADER: true,
  SET_COOKIE_HEADER: true,
  DB_URI: true,
  AWS_ACCESS_KEY: true,
  GITHUB_TOKEN: true,
  DEVELOPER_TOKEN: true,
  SLACK_TOKEN: true,
  GOOGLE_API_KEY: true,
  PROVIDER_API_KEY: true,
  CLOUD_CREDENTIAL: true,
  CONNECTION_STRING: true,
  ENCODED_SECRET: true,
  BASE64_TOKEN: true,
  STRIPE_KEY: true,
  SENDGRID_KEY: true,
  CONTEXTUAL_SECRET: true,
  SENSITIVE_FILENAME: true,
  PHONE: true,
  EMAIL: true,
  ID_CARD: true,
  BANK_CARD: true,
  LANDLINE: true,
  PLATE: true,
  IP_PRIVATE: true,
  IP_INTERNAL: false,
  IPV6_PRIVATE: false,
  IBAN: true,
  USCC: false,
  MAC: false,
  HKID: false,
  CUSTOM_TERM: true,
};

// Default values for hot-reloadable configs
export const DEFAULT_CONFIG_VALUES = {
  CONTEXT_KEY_MIN_LENGTH: 8,
  CONTEXT_KEY_MAX_LENGTH: 200,
  CONTEXT_KEY_MAX_SPACES: 2,
  CONTEXT_WINDOW_SIZE: 200,
  PATH_PREFIX_OPTIONS: ["/v1/messages", "/v1/responses", "/v1beta"],
  RULE_TOGGLES: DEFAULT_RULE_TOGGLES,
  SECRET_PREFIXES: ["sk-"],
  SECRET_PREFIX_MIN_LENGTH: 8,
  LOG_RETENTION_DAYS: 7,
  AUDIT_SEVERITY_FLOOR: "MEDIUM",
  FAIL_CLOSED: "1",
  MAX_BODY_MB: 32,
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

export const SCANNER_RULES: Record<FindingCategory, boolean> = { ...DEFAULT_RULE_TOGGLES };

export function isRuleEnabled(category: FindingCategory): boolean {
  return SCANNER_RULES[category] !== false;
}

// 引擎级运行时开关(热加载):fail_closed/max_body_mb/留存/信号阈值/自定义前缀
export const RUNTIME = {
  failClosed: true,
  maxBodyBytes: DEFAULT_CONFIG_VALUES.MAX_BODY_MB * 1024 * 1024,
  logRetentionDays: DEFAULT_CONFIG_VALUES.LOG_RETENTION_DAYS,
  severityFloor: DEFAULT_CONFIG_VALUES.AUDIT_SEVERITY_FLOOR as Severity,
  secretPrefixes: [...DEFAULT_CONFIG_VALUES.SECRET_PREFIXES],
  secretPrefixMinLen: DEFAULT_CONFIG_VALUES.SECRET_PREFIX_MIN_LENGTH,
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

// 默认上游(可选,实时读 env):设置时无渠道前缀请求走它(存量兼容);
// 未设置时无默认路由——未匹配路径一律 404(防外网枚举常见 API 路径)
export function getDefaultUpstream(): string | null {
  const value = process.env.UPSTREAM_URL;
  return value && value.length > 0 ? value : null;
}

export { DB_PATH, DEBUG, SECRET_SCANNER_MODE, PRIVACY_MASK_FORMAT, PRIVACY_DISAMBIGUATION_MODE, PRIVACY_NOTICE_TEXT, PRIVACY_DEBUG_HEADERS };
