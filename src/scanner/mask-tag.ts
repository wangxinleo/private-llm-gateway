import { randomInt, createHmac, randomBytes } from "node:crypto";
import type { FindingCategory } from "@/types";

const PRIVACY_MASK_FORMAT = process.env.PRIVACY_MASK_FORMAT ?? "explicit";

export function buildMaskTag(category: FindingCategory): string {
  if (PRIVACY_MASK_FORMAT === "legacy") {
    return `[${category}]`;
  }
  return `<<PRIVACY_MASK:${category}>>`;
}

export const MAX_SHORTCODE_LEN = 12;

export const CATEGORY_SHORTCODES: Readonly<Record<FindingCategory, string>> = {
  PRIVATE_KEY: "PRIVATE_KEY",
  BEARER_TOKEN: "BEARER",
  BASIC_AUTH: "BASIC_AUTH",
  JWT: "JWT",
  COOKIE_HEADER: "COOKIE",
  SET_COOKIE_HEADER: "SET_COOKIE",
  DB_URI: "DB_URI",
  AWS_ACCESS_KEY: "AWS_KEY",
  GITHUB_TOKEN: "GITHUB",
  DEVELOPER_TOKEN: "DEVELOPER",
  SLACK_TOKEN: "SLACK",
  GOOGLE_API_KEY: "GOOGLE",
  PROVIDER_API_KEY: "API_KEY",
  CLOUD_CREDENTIAL: "CLOUD",
  CONNECTION_STRING: "CONNSTR",
  ENCODED_SECRET: "ENCODED",
  BASE64_TOKEN: "BASE64",
  STRIPE_KEY: "STRIPE",
  SENDGRID_KEY: "SENDGRID",
  CONTEXTUAL_SECRET: "SECRET",
  HIGH_ENTROPY: "HIGHENT",
  SENSITIVE_FILENAME: "FILENAME",
  PHONE: "PHONE",
  EMAIL: "EMAIL",
  ID_CARD: "ID_CARD",
  BANK_CARD: "BANK_CARD",
  LANDLINE: "LANDLINE",
  PLATE: "PLATE",
  IP_PRIVATE: "IPPRIVATE",
  IP_INTERNAL: "IPINTERN",
  IPV6_PRIVATE: "IPV6PRIV",
  IBAN: "IBAN",
  USCC: "USCC",
  MAC: "MAC",
  HKID: "HKID",
  CUSTOM_TERM: "TERM",
};

export function categoryShortCode(category: FindingCategory): string {
  return CATEGORY_SHORTCODES[category];
}

export const CONSONANTS = "bcdfghjkmnpqrstvwxz";
export const SUFFIX_LEN = 5;

export function randomConsonant5(): string {
  let suffix = "";
  for (let i = 0; i < SUFFIX_LEN; i++) {
    suffix += CONSONANTS[randomInt(CONSONANTS.length)];
  }
  return suffix;
}

// ===== 加盐确定性后缀(G7) =====
//
// spec 变更(09-10 R8 → 本任务):09-10 禁止"后缀从原文哈希派生",论据是**无盐**派生
// 构成上游猜测-验证 Oracle。现改为 HMAC-SHA256(进程密钥, attempt‖category‖value):
// - 密钥 ≥128bit,默认进程随机(randomBytes(32)),可用 PRIVACY_SUFFIX_SECRET 固定
//   → 多副本/重启映射一致,Prompt Cache 前缀跨请求/跨实例稳定
// - 密钥保密时上游无法自算 suffix → Oracle 关闭;密钥泄漏则 Oracle 重开(明示威胁边界)
// - 已知联动:上游可跨请求关联同一实体的出现(与 maskit 复用表同性质);单用户自用可接受
// - 冲突链由 MaskRegistry 用 attempt 递增处理;4 次仍冲突退回随机兜底(罕见,保正确性)
export type SuffixDeriver = (category: string, value: string, attempt: number) => string;

function resolveSuffixSecret(envValue: string | undefined): Buffer {
  if (envValue && envValue.length >= 16) return Buffer.from(envValue, "utf8");
  return randomBytes(32);
}

const PROCESS_SUFFIX_SECRET = resolveSuffixSecret(process.env.PRIVACY_SUFFIX_SECRET);

export function createSuffixDeriver(secret: Buffer = PROCESS_SUFFIX_SECRET): SuffixDeriver {
  return (category, value, attempt) => {
    const digest = createHmac("sha256", secret).update(`${attempt}\u0000${category}\u0000${value}`, "utf8").digest();
    let suffix = "";
    for (let i = 0; i < SUFFIX_LEN; i++) {
      suffix += CONSONANTS[digest[i]! % CONSONANTS.length];
    }
    return suffix;
  };
}

export const deriveConsonantSuffix: SuffixDeriver = createSuffixDeriver();

export const TAG_RE = /\{\{[A-Z][A-Z0-9_]*_[bcdfghjkmnpqrstvwxzBCDFGHJKMNPQRSTVWXZ]{5}\}\}/;
export const TAG_PARTIAL_RE = /\{\{(?:[A-Z][A-Z0-9_]*)?(?:_[bcdfghjkmnpqrstvwxzBCDFGHJKMNPQRSTVWXZ]{0,5})?\}?$/;
// 标签主体(宽松):大小写不敏感 + 后缀必须是 5 个辅音字母。
// 空白只作为花括号内衬消耗(`{{ PHONE_x }}`),裸 token 不吞邻接空白,
// 否则 "and PHONE_x" 会把分隔空格一起替换掉
const LOOSE_CORE = "[A-Za-z][A-Za-z0-9_]*_[bcdfghjkmnpqrstvwxzBCDFGHJKMNPQRSTVWXZ]{5}";
// 宽松遍(修复降级形态),按优先级:带括号(1-2 重、括号内可空白)/ 悬空开括号 / 裸 token。
// 空白只随花括号消耗;裸 token 与悬空形态都不吞邻接空白,否则 "and PHONE_x" 会把
// 分隔空格一起替换掉。命中与否由调用方按规范标签查 registry 决定
export const LOOSE_RX = new RegExp(
  `\\{\\{?\\s?${LOOSE_CORE}\\s?\\}?\\}|\\{\\{?\\s?${LOOSE_CORE}|${LOOSE_CORE}`,
  "g"
);
export const EXPLICIT_TAG_RE = /<<PRIVACY_MASK:[A-Z][A-Z0-9_]*(?::\d+)?>>/g;
export const LEGACY_TAG_RE = /\[[A-Z][A-Z0-9_]*\]/g;
export const MAX_TAG_LEN = 2 + MAX_SHORTCODE_LEN + 1 + SUFFIX_LEN + 2;
