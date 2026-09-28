import { describe, it, expect } from "vitest";
import {
  CATEGORY_SHORTCODES,
  MAX_SHORTCODE_LEN,
  MAX_TAG_LEN,
  TAG_RE,
  TAG_PARTIAL_RE,
  LOOSE_RX,
} from "@/scanner/mask-tag";

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

  it("LOOSE_RX tolerates inner whitespace without eating adjacent separators", () => {
    expect("x {{ PHONE_TRWMQ }} y".match(LOOSE_RX)).toEqual(["{{ PHONE_TRWMQ }}"]);
    expect("x { PHONE_TRWMQ } y".match(LOOSE_RX)).toEqual(["{ PHONE_TRWMQ }"]);
    // 裸 token 两侧的空格必须保留在 match 之外(修复替换不得吞分隔空格)
    expect("and PHONE_TRWMQ end".match(LOOSE_RX)).toEqual(["PHONE_TRWMQ"]);
  });

  it("LOOSE_RX rejects template-like text", () => {
    expect("{{ user.name }}".match(LOOSE_RX)).toBeNull();
    expect("{{PHONE_FAKE1}}".match(LOOSE_RX)).toBeNull();
    expect("{{X_12345}}".match(LOOSE_RX)).toBeNull();
  });
});
