import { randomInt } from "node:crypto";
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
  SENSITIVE_FILENAME: "FILENAME",
  PHONE: "PHONE",
  EMAIL: "EMAIL",
  ID_CARD: "ID_CARD",
  BANK_CARD: "BANK_CARD",
  LANDLINE: "LANDLINE",
  PLATE: "PLATE",
  IP_PRIVATE: "IPPRIVATE",
  IP_INTERNAL: "IPINTERN",
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

export const TAG_RE = /\{\{[A-Z][A-Z0-9_]*_[bcdfghjkmnpqrstvwxzBCDFGHJKMNPQRSTVWXZ]{5}\}\}/;
export const TAG_PARTIAL_RE = /\{\{(?:[A-Z][A-Z0-9_]*)?(?:_[bcdfghjkmnpqrstvwxzBCDFGHJKMNPQRSTVWXZ]{0,5})?\}?$/;
export const LOOSE_RX = /\{{0,2}[A-Z][A-Z0-9_]*_[bcdfghjkmnpqrstvwxzBCDFGHJKMNPQRSTVWXZ]{5}\}{0,2}/g;
export const EXPLICIT_TAG_RE = /<<PRIVACY_MASK:[A-Z][A-Z0-9_]*(?::\d+)?>>/g;
export const LEGACY_TAG_RE = /\[[A-Z][A-Z0-9_]*\]/g;
export const MAX_TAG_LEN = 2 + MAX_SHORTCODE_LEN + 1 + SUFFIX_LEN + 2;
