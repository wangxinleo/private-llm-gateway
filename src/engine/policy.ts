import type { Finding, ActionType } from "@/types";
import { isBlockCategory } from "@/types";

export function resolveAction(findings: Finding[]): ActionType {
  const hasBlock = findings.some((f) => isBlockCategory(f.category));
  if (hasBlock) return "block";

  const hasMask = findings.some((f) => f.action === "mask");
  if (hasMask) return "mask";

  return "allow";
}

export function blockedResponse(findings: Finding[]): {
  status: number;
  body: Record<string, unknown>;
} {
  const blockedTypes = [
    ...new Set(
      findings
        .filter((f) => isBlockCategory(f.category))
        .map((f) => f.category)
    ),
  ];

  return {
    status: 403,
    body: {
      error: "blocked_by_privacy_proxy",
      blocked_types: blockedTypes,
    },
  };
}
