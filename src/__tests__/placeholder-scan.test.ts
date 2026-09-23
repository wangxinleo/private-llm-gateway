import { describe, it, expect } from "vitest";
import { canonicalTag, findResidualPlaceholders, isNoticeExampleTag } from "@/scanner/placeholder-scan";

describe("canonicalTag", () => {
  it("normalizes tolerant shapes to the canonical tag", () => {
    expect(canonicalTag("{{PHONE_trwmq}}")).toBe("{{PHONE_trwmq}}");
    expect(canonicalTag("{{ PHONE_trwmq }}")).toBe("{{PHONE_trwmq}}");
    expect(canonicalTag("{PHONE_trwmq}")).toBe("{{PHONE_trwmq}}");
    expect(canonicalTag("PHONE_trwmq")).toBe("{{PHONE_trwmq}}");
    expect(canonicalTag("{{phone_trwmq}}")).toBe("{{PHONE_trwmq}}");
  });

  it("rejects unknown labels, illegal suffixes and brace-free noise", () => {
    expect(canonicalTag("{{USER_trwmq}}")).toBeNull();
    expect(canonicalTag("{{PHONE_troma}}")).toBeNull();
    expect(canonicalTag("{{PHONE_trom}}")).toBeNull();
    expect(canonicalTag("no tag here")).toBeNull();
  });
});

describe("findResidualPlaceholders", () => {
  it("counts tolerant shapes: strict, missing braces, inner whitespace, lowercase label", () => {
    const text = "{{PHONE_trwmq}} {EMAIL_bcdfg} {{ ID_CARD_knpqr }} phone_trwmq";
    const result = findResidualPlaceholders(text);
    expect(result.count).toBe(4);
    expect(result.samples).toEqual([
      "{{PHONE_trwmq}}",
      "{EMAIL_bcdfg}",
      "{{ ID_CARD_knpqr }}",
      "phone_trwmq",
    ]);
  });

  it("ignores unknown labels, non-consonant suffixes and template noise", () => {
    const text = "{{user_name}} {{UNKNOWN_trwmq}} {{PHONE_12345}} {{{{PHONE_trwmq}}}}";
    // 四重花括号内嵌的真 token 仍会被匹配到,但外面两重不构成额外计入
    const result = findResidualPlaceholders(text);
    expect(result.count).toBe(1);
    expect(result.samples).toEqual(["{{PHONE_trwmq}}"]);
  });

  it("exempts notice example tags only", () => {
    expect(isNoticeExampleTag("{{EMAIL_trwmq}}")).toBe(true);
    expect(isNoticeExampleTag("{{PHONE_trwmq}}")).toBe(false);
    expect(findResidualPlaceholders("example {{EMAIL_trwmq}} stays").count).toBe(0);
    const mixed = findResidualPlaceholders("like {{EMAIL_trwmq}} but also {{PHONE_qgqhn}}");
    expect(mixed.count).toBe(1);
    expect(mixed.samples).toEqual(["{{PHONE_qgqhn}}"]);
  });

  it("caps samples at 5, dedupes repeats and never leaks plaintext", () => {
    const unique = ["PHONE_bbbbb", "PHONE_ccccc", "PHONE_ddddd", "PHONE_fffff", "PHONE_ggggg", "PHONE_hhhhh", "PHONE_jjjjj"];
    const text = [...unique.flatMap((t) => [t, t]), "call 13812345678"].join(" ");
    const result = findResidualPlaceholders(text);
    expect(result.count).toBe(14);
    expect(result.samples).toEqual(unique.slice(0, 5));
    expect(result.samples.join(" ")).not.toContain("13812345678");
  });
});
