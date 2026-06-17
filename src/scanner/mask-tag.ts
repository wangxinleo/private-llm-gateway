import type { FindingCategory } from "@/types";

const PRIVACY_MASK_FORMAT = process.env.PRIVACY_MASK_FORMAT ?? "explicit";

export function buildMaskTag(category: FindingCategory): string {
  if (PRIVACY_MASK_FORMAT === "legacy") {
    return `[${category}]`;
  }
  return `<<PRIVACY_MASK:${category}>>`;
}
