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

  it("ignores short values (< 8 chars)", () => {
    const f = scanContextKey(`"api_key": "short"`);
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

  it("detects username field with suspicious value", () => {
    const f = scanContextKey(`username: 'q5BW236ytM56HrV74n-1'`);
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe("CONTEXTUAL_SECRET");
    expect(f[0].matched).toBe("q5BW236ytM56HrV74n-1");
  });

  it("detects short password (16 chars)", () => {
    const f = scanContextKey(`password: 'mD37cD563VG6UrtL'`);
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe("CONTEXTUAL_SECRET");
    expect(f[0].matched).toBe("mD37cD563VG6UrtL");
  });

  it("detects both username and password in combined text", () => {
    const f = scanContextKey(
      `username: 'q5BW236ytM56HrV74n-1', password: 'mD37cD563VG6UrtL'`
    );
    expect(f).toHaveLength(2);
    expect(f.some((x) => x.matched === "q5BW236ytM56HrV74n-1")).toBe(true);
    expect(f.some((x) => x.matched === "mD37cD563VG6UrtL")).toBe(true);
  });
});

describe("scanContextKey — multi-format coverage", () => {
  const val = "q5BW236ytM56HrV74n-1";

  it("detects bracket access key[value]", () => {
    const f = scanContextKey(`username[${val}]`);
    expect(f).toHaveLength(1);
    expect(f[0].matched).toBe(val);
  });

  it("detects bracket access key['value']", () => {
    const f = scanContextKey(`username['${val}']`);
    expect(f).toHaveLength(1);
    expect(f[0].matched).toBe(val);
  });

  it("detects bracket access key[\"value\"]", () => {
    const f = scanContextKey(`username["${val}"]`);
    expect(f).toHaveLength(1);
    expect(f[0].matched).toBe(val);
  });

  it("detects dict access ['key'] = value", () => {
    const f = scanContextKey(`config["username"] = "${val}"`);
    expect(f).toHaveLength(1);
    expect(f[0].matched).toBe(val);
  });

  it("detects XML tag <key>value</key>", () => {
    const f = scanContextKey(`<username>${val}</username>`);
    expect(f).toHaveLength(1);
    expect(f[0].matched).toBe(val);
  });

  it("detects newline-separated key\\nvalue", () => {
    const f = scanContextKey(`username\n${val}`);
    expect(f).toHaveLength(1);
    expect(f[0].matched).toBe(val);
  });

  it("detects dot notation .key. value", () => {
    const f = scanContextKey(`config.username.${val}`);
    expect(f).toHaveLength(1);
    expect(f[0].matched).toBe(val);
  });

  it("detects URL query params without swallowing adjacent values", () => {
    const f = scanContextKey(`username=${val}&password=mD37cD563VG6UrtL`);
    expect(f).toHaveLength(2);
    expect(f.some((x) => x.matched === val)).toBe(true);
    expect(f.some((x) => x.matched === "mD37cD563VG6UrtL")).toBe(true);
  });
});
