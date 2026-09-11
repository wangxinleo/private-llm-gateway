import { describe, it, expect } from "vitest";
import {
  buildMaskTag,
  CATEGORY_SHORTCODES,
  MAX_SHORTCODE_LEN,
  MAX_TAG_LEN,
  TAG_RE,
  TAG_PARTIAL_RE,
  LOOSE_RX,
} from "@/scanner/mask-tag";

describe("buildMaskTag (explicit format)", () => {
  it("EMAIL -> <<PRIVACY_MASK:EMAIL>>", () => {
    expect(buildMaskTag("EMAIL")).toBe("<<PRIVACY_MASK:EMAIL>>");
  });

  it("PHONE -> <<PRIVACY_MASK:PHONE>>", () => {
    expect(buildMaskTag("PHONE")).toBe("<<PRIVACY_MASK:PHONE>>");
  });

  it("ID_CARD -> <<PRIVACY_MASK:ID_CARD>>", () => {
    expect(buildMaskTag("ID_CARD")).toBe("<<PRIVACY_MASK:ID_CARD>>");
  });

  it("BANK_CARD -> <<PRIVACY_MASK:BANK_CARD>>", () => {
    expect(buildMaskTag("BANK_CARD")).toBe("<<PRIVACY_MASK:BANK_CARD>>");
  });

  it("PRIVATE_KEY -> <<PRIVACY_MASK:PRIVATE_KEY>>", () => {
    expect(buildMaskTag("PRIVATE_KEY")).toBe("<<PRIVACY_MASK:PRIVATE_KEY>>");
  });

  it("BEARER_TOKEN -> <<PRIVACY_MASK:BEARER_TOKEN>>", () => {
    expect(buildMaskTag("BEARER_TOKEN")).toBe("<<PRIVACY_MASK:BEARER_TOKEN>>");
  });

  it("CONTEXTUAL_SECRET -> <<PRIVACY_MASK:CONTEXTUAL_SECRET>>", () => {
    expect(buildMaskTag("CONTEXTUAL_SECRET")).toBe("<<PRIVACY_MASK:CONTEXTUAL_SECRET>>");
  });

  it("JWT -> <<PRIVACY_MASK:JWT>>", () => {
    expect(buildMaskTag("JWT")).toBe("<<PRIVACY_MASK:JWT>>");
  });

  it("AWS_ACCESS_KEY -> <<PRIVACY_MASK:AWS_ACCESS_KEY>>", () => {
    expect(buildMaskTag("AWS_ACCESS_KEY")).toBe("<<PRIVACY_MASK:AWS_ACCESS_KEY>>");
  });

  it("GITHUB_TOKEN -> <<PRIVACY_MASK:GITHUB_TOKEN>>", () => {
    expect(buildMaskTag("GITHUB_TOKEN")).toBe("<<PRIVACY_MASK:GITHUB_TOKEN>>");
  });
});

describe("v3 semantic tag grammar", () => {
  it("short-code whitelist is uppercase, <=12 chars, unique and total", () => {
    const codes = Object.values(CATEGORY_SHORTCODES);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(code.length).toBeLessThanOrEqual(MAX_SHORTCODE_LEN);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("MAX_TAG_LEN covers the longest possible tag", () => {
    const longest = `{{${"PRIVATE_KEY".padEnd(MAX_SHORTCODE_LEN, "X")}_${"b".repeat(5)}}}`;
    expect(longest.length).toBeLessThanOrEqual(MAX_TAG_LEN);
    expect(MAX_TAG_LEN).toBe(22);
  });

  it("TAG_RE matches strict semantic tags", () => {
    expect(TAG_RE.test("{{PHONE_TRWMQ}}")).toBe(true);
    expect(TAG_RE.test("{{BASIC_AUTH_TRWMQ}}")).toBe(true);
    expect(TAG_RE.test("prefix {{EMAIL_TRWMQ}} suffix")).toBe(true);
  });

  it("TAG_RE rejects malformed lookalikes", () => {
    expect(TAG_RE.test("{{PHONE_TRWMQ}")).toBe(false);
    expect(TAG_RE.test("{{PHONE_ABCDE}}")).toBe(false);
    expect(TAG_RE.test("{{PHONE_12345}}")).toBe(false);
    expect(TAG_RE.test("{{phone_TRWMQ}}")).toBe(false);
    expect(TAG_RE.test("{{ user.name }}")).toBe(false);
    expect(TAG_RE.test("{{X_12345}}")).toBe(false);
  });

  it("TAG_PARTIAL_RE matches only dangling prefixes", () => {
    expect(TAG_PARTIAL_RE.test("hello {{")).toBe(true);
    expect(TAG_PARTIAL_RE.test("hello {{PHO")).toBe(true);
    expect(TAG_PARTIAL_RE.test("hello {{PHONE_")).toBe(true);
    expect(TAG_PARTIAL_RE.test("hello {{PHONE_TRW")).toBe(true);
    expect(TAG_PARTIAL_RE.test("complete {{PHONE_TRWMQ}}")).toBe(false);
    expect(TAG_PARTIAL_RE.test("no tag here")).toBe(false);
  });

  it("LOOSE_RX matches degraded forms with 0-2 braces per side", () => {
    expect("x SECRET_TRWMQ y".match(LOOSE_RX)).toEqual(["SECRET_TRWMQ"]);
    expect("x {PHONE_TRWMQ y".match(LOOSE_RX)).toEqual(["{PHONE_TRWMQ"]);
    expect("x {{PHONE_TRWMQ}} y".match(LOOSE_RX)).toEqual(["{{PHONE_TRWMQ}}"]);
    expect("x {{PHONE_TRWMQ} y".match(LOOSE_RX)).toEqual(["{{PHONE_TRWMQ}"]);
    expect("x {PHONE_TRWMQ}} y".match(LOOSE_RX)).toEqual(["{PHONE_TRWMQ}}"]);
    expect("abc{{PHONE_TRWMQ}}def".match(LOOSE_RX)).toEqual(["{{PHONE_TRWMQ}}"]);
    expect("MYSECRET_TRWMQ".match(LOOSE_RX)).toEqual(["MYSECRET_TRWMQ"]);
  });

  it("LOOSE_RX rejects template-like text", () => {
    expect("{{ user.name }}".match(LOOSE_RX)).toBeNull();
    expect("{{PHONE_FAKE1}}".match(LOOSE_RX)).toBeNull();
    expect("{{X_12345}}".match(LOOSE_RX)).toBeNull();
  });
});
