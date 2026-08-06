import type { EditableConfigValue, HighRiskAssets } from "@/types";

export function isStringArrayConfigValue(value: EditableConfigValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isHighRiskAssets(value: unknown): value is HighRiskAssets {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const assets = value as Partial<HighRiskAssets>;
  const isStringArray = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((item) => typeof item === "string");
  return (assets.domains === undefined || isStringArray(assets.domains)) &&
    (assets.emails === undefined || isStringArray(assets.emails)) &&
    (assets.accounts === undefined || isStringArray(assets.accounts));
}

export function getErrorText(value: unknown): string | null {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string"
    ? value.error
    : null;
}