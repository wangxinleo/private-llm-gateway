import type { EditableConfigValue, ExclusionRule } from "@/types";

export function isStringArrayConfigValue(value: EditableConfigValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isExclusionRule(value: unknown): value is ExclusionRule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Partial<ExclusionRule>;
  return typeof rule.category === "string" &&
    (rule.mode === "exact" || rule.mode === "regex") &&
    typeof rule.value === "string";
}

export function isExclusionRuleArray(value: unknown): value is ExclusionRule[] {
  return Array.isArray(value) && value.every(isExclusionRule);
}

export function getErrorText(value: unknown): string | null {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string"
    ? value.error
    : null;
}
