import { describe, it, expect } from "vitest";
import { scanContextKey } from "@/scanner/context-key";

describe("scanContextKey — mask rules", () => {
  const suspiciousValue = "aBcDeFgHiJkLmNoPqRsTuVwXyZ012";

  it("detects api_key with suspicious value", () => {
    const f = scanContextKey(`"api_key": "${suspiciousValue}"`);
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe("CONTEXTUAL_SECRET");
    expect(f[0].action).toBe("mask");
    expect(f[0].maskTag).toBe("[CONTEXTUAL_SECRET]");
  });

  it("detects secret_key with suspicious value", () => {
    const f = scanContextKey(`secret_key=${suspiciousValue}`);
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe("CONTEXTUAL_SECRET");
  });

  it("detects password field with suspicious value", () => {
    const f = scanContextKey(`"password": "${suspiciousValue}"`);
    expect(f).toHaveLength(1);
  });

  it("detects token field with suspicious value", () => {
    const f = scanContextKey(`token=${suspiciousValue}`);
    expect(f).toHaveLength(1);
  });

  it("detects authorization field", () => {
    const f = scanContextKey(`"authorization": "${suspiciousValue}"`);
    expect(f).toHaveLength(1);
  });

  it("detects credential field", () => {
    const f = scanContextKey(`credentials=${suspiciousValue}`);
    expect(f).toHaveLength(1);
  });

  it("detects client_secret field", () => {
    const f = scanContextKey(`client_secret: ${suspiciousValue}`);
    expect(f).toHaveLength(1);
  });

  it("stores actual suspicious value in matched", () => {
    const f = scanContextKey(`"api_key": "${suspiciousValue}"`);
    expect(f[0].matched).toBe(suspiciousValue);
  });

  it("ignores short values (< 20 chars)", () => {
    const f = scanContextKey(`"api_key": "short123"`);
    expect(f).toHaveLength(0);
  });

  it("ignores values > 200 chars", () => {
    const longValue = "a".repeat(201);
    const f = scanContextKey(`"api_key": "${longValue}"`);
    expect(f).toHaveLength(0);
  });

  it("ignores normal descriptive values (too many spaces/invalid chars)", () => {
    const f = scanContextKey(
      `"api_key": "this is a normal description of the key"`
    );
    expect(f).toHaveLength(0);
  });

  it("deduplicates same value across multiple keys", () => {
    const f = scanContextKey(`
      "api_key": "${suspiciousValue}"
      "secret": "${suspiciousValue}"
    `);
    expect(f).toHaveLength(1);
  });

  it("returns empty for text without key-value pairs", () => {
    const f = scanContextKey(
      "Just some random text without any keys or secrets"
    );
    expect(f).toHaveLength(0);
  });

  it("handles key field name", () => {
    const f = scanContextKey(`"key": "${suspiciousValue}"`);
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe("CONTEXTUAL_SECRET");
  });
});
