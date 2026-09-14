import type { EditableConfigValue } from "@/types";

export function isStringArrayConfigValue(value: EditableConfigValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function getErrorText(value: unknown): string | null {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string"
    ? value.error
    : null;
}