import { describe, it, expect, beforeEach } from "vitest";
import type { Finding } from "@/types";
import { applyExclusions } from "@/scanner/exclusions";
import { SCANNER_EXCLUSIONS, DEFAULT_EXCLUSION_RULES } from "@/config";

describe("applyExclusions", () => {
  it("returns all findings when no exclusions configured", () => {
    const findings: Finding[] = [
      { category: "EMAIL", action: "mask", matched: "user@example.com" },
    ];
    SCANNER_EXCLUSIONS.length = 0;
    expect(applyExclusions(findings)).toEqual(findings);
  });

  it("removes finding matching exact value rule", () => {
    SCANNER_EXCLUSIONS.length = 0;
    SCANNER_EXCLUSIONS.push({
      category: "EMAIL",
      mode: "exact",
      value: "n@router.post",
    });
    const findings: Finding[] = [
      { category: "EMAIL", action: "mask", matched: "n@router.post" },
      { category: "EMAIL", action: "mask", matched: "real@example.com" },
    ];
    const result = applyExclusions(findings);
    expect(result).toHaveLength(1);
    expect(result[0]!.matched).toBe("real@example.com");
  });

  it("removes finding matching regex rule", () => {
    SCANNER_EXCLUSIONS.length = 0;
    SCANNER_EXCLUSIONS.push({
      category: "BASIC_AUTH",
      mode: "regex",
      value: "basic (info|searches|details)",
    });
    const findings: Finding[] = [
      { category: "BASIC_AUTH", action: "mask", matched: "basic info" },
      { category: "BASIC_AUTH", action: "mask", matched: "basic dXNlcjpwYXNz" },
    ];
    const result = applyExclusions(findings);
    expect(result).toHaveLength(1);
    expect(result[0]!.matched).toBe("basic dXNlcjpwYXNz");
  });

  it("only matches rules for the same category", () => {
    SCANNER_EXCLUSIONS.length = 0;
    SCANNER_EXCLUSIONS.push({
      category: "BEARER_TOKEN",
      mode: "exact",
      value: "Bearer token",
    });
    const findings: Finding[] = [
      { category: "BEARER_TOKEN", action: "mask", matched: "Bearer token" },
      { category: "BASIC_AUTH", action: "mask", matched: "Bearer token" },
    ];
    const result = applyExclusions(findings);
    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe("BASIC_AUTH");
  });

  it("handles multiple exclusion rules across categories", () => {
    SCANNER_EXCLUSIONS.length = 0;
    SCANNER_EXCLUSIONS.push(
      { category: "EMAIL", mode: "exact", value: "n@router.post" },
      { category: "BEARER_TOKEN", mode: "exact", value: "Bearer token" },
      { category: "BASIC_AUTH", mode: "regex", value: "^[Bb]asic (info|searches)" },
    );
    const findings: Finding[] = [
      { category: "EMAIL", action: "mask", matched: "n@router.post" },
      { category: "BEARER_TOKEN", action: "mask", matched: "Bearer token" },
      { category: "BASIC_AUTH", action: "mask", matched: "basic info" },
      { category: "BASIC_AUTH", action: "mask", matched: "basic searches" },
      { category: "EMAIL", action: "mask", matched: "keep@example.com" },
    ];
    const result = applyExclusions(findings);
    expect(result).toHaveLength(1);
    expect(result[0]!.matched).toBe("keep@example.com");
  });

  it("returns empty array when all findings are excluded", () => {
    SCANNER_EXCLUSIONS.length = 0;
    SCANNER_EXCLUSIONS.push({
      category: "EMAIL",
      mode: "regex",
      value: ".*",
    });
    const findings: Finding[] = [
      { category: "EMAIL", action: "mask", matched: "a@b.com" },
      { category: "EMAIL", action: "mask", matched: "c@d.com" },
    ];
    expect(applyExclusions(findings)).toHaveLength(0);
  });

  it("does not exclude findings when rule category does not match", () => {
    SCANNER_EXCLUSIONS.length = 0;
    SCANNER_EXCLUSIONS.push({
      category: "PHONE",
      mode: "exact",
      value: "13912345678",
    });
    const findings: Finding[] = [
      { category: "EMAIL", action: "mask", matched: "13912345678" },
    ];
    expect(applyExclusions(findings)).toHaveLength(1);
  });

  it("handles invalid regex gracefully (treats as no match)", () => {
    SCANNER_EXCLUSIONS.length = 0;
    SCANNER_EXCLUSIONS.push({
      category: "EMAIL",
      mode: "regex",
      value: "[invalid",
    });
    const findings: Finding[] = [
      { category: "EMAIL", action: "mask", matched: "test@example.com" },
    ];
    expect(applyExclusions(findings)).toHaveLength(1);
  });
});

describe("DEFAULT_EXCLUSION_RULES", () => {
  it("contains default rules for known false positives", () => {
    expect(DEFAULT_EXCLUSION_RULES.length).toBeGreaterThan(0);
    const categories = DEFAULT_EXCLUSION_RULES.map(r => r.category);
    expect(categories).toContain("EMAIL");
    expect(categories).toContain("BASIC_AUTH");
    expect(categories).toContain("BEARER_TOKEN");
  });
});
