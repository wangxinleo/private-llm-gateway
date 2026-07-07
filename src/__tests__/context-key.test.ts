import { describe, it, expect } from "vitest";
import { scanContextKey } from "@/scanner/context-key";

const suspiciousValue = "aBcDeFgHiJkLmNoPqRsTuVwXyZ012";
const suspiciousPwd = "k8s-Prod2024!Sec";

describe("scanContextKey — SECRET_KEYS solo-trigger", () => {
  it("detects api_key with suspicious value", () => {
    const f = scanContextKey(`"api_key": "${suspiciousValue}"`);
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe("CONTEXTUAL_SECRET");
    expect(f[0].action).toBe("mask");
    expect(f[0].maskTag).toBe("<<PRIVACY_MASK:CONTEXTUAL_SECRET>>");
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

  it("detects access_token field", () => {
    const f = scanContextKey(`access_token=${suspiciousValue}`);
    expect(f).toHaveLength(1);
  });

  it("stores actual suspicious value in matched", () => {
    const f = scanContextKey(`"api_key": "${suspiciousValue}"`);
    expect(f[0].matched).toBe(suspiciousValue);
  });
});

describe("scanContextKey — IDENTITY_KEYS pair-trigger", () => {
  it("detects username when secret key also present", () => {
    const f = scanContextKey(
      `"username": "q5BW236ytM56HrV74n", "password": "${suspiciousValue}"`
    );
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(f.some((x) => x.matched === "q5BW236ytM56HrV74n")).toBe(true);
    expect(f.some((x) => x.matched === suspiciousValue)).toBe(true);
  });

  it("ignores username when no secret key present", () => {
    const f = scanContextKey(`"username": "q5BW236ytM56HrV74n"`);
    expect(f).toHaveLength(0);
  });

  it("ignores token when no secret key present", () => {
    const f = scanContextKey(`"token": ${suspiciousValue}`);
    expect(f).toHaveLength(0);
  });

  it("detects session_id when secret key also present", () => {
    const f = scanContextKey(
      `"session_id": "xY7zW9pQ2mL4kR8n", "api_key": "${suspiciousValue}"`
    );
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(f.some((x) => x.matched === "xY7zW9pQ2mL4kR8n")).toBe(true);
  });

  it("ignores session_id when no secret key present", () => {
    const f = scanContextKey(`"session_id": "xY7zW9pQ2mL4kR8n"`);
    expect(f).toHaveLength(0);
  });
});

describe("scanContextKey — value filtering", () => {
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

  it("ignores pure-alpha values", () => {
    const f = scanContextKey(`"api_key": "productionDefaultValue"`);
    expect(f).toHaveLength(0);
  });

  it("ignores pure-digit values", () => {
    const f = scanContextKey(`"api_key": "1234567890123456"`);
    expect(f).toHaveLength(0);
  });

  it("ignores values without digit or symbol", () => {
    const f = scanContextKey(`"api_key": "camelCaseWordsOnly"`);
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
});

describe("scanContextKey — false positive rejection", () => {
  it("ignores 'key' field (too broad)", () => {
    const f = scanContextKey(`"key": "${suspiciousValue}"`);
    expect(f).toHaveLength(0);
  });

  it("ignores 'user' field (too broad)", () => {
    const f = scanContextKey(`"user": "admin"`);
    expect(f).toHaveLength(0);
  });

  it("ignores 'email' field (handled by PII rules)", () => {
    const f = scanContextKey(`"email": "test@example.com"`);
    expect(f).toHaveLength(0);
  });

  it("ignores 'auth' field (too broad)", () => {
    const f = scanContextKey(`"auth": "oauth2"`);
    expect(f).toHaveLength(0);
  });

  it("ignores model names in 'key' context", () => {
    const f = scanContextKey(`"key": "gpt-4.1-mini"`);
    expect(f).toHaveLength(0);
  });
});

describe("scanContextKey — multi-format coverage", () => {
  const val = "q5BW236ytM56HrV74n-1";

  it("detects bracket access key[value]", () => {
    const f = scanContextKey(`password[${val}]`);
    expect(f).toHaveLength(1);
    expect(f[0].matched).toBe(val);
  });

  it("detects bracket access key['value']", () => {
    const f = scanContextKey(`password['${val}']`);
    expect(f).toHaveLength(1);
    expect(f[0].matched).toBe(val);
  });

  it("detects bracket access key[\"value\"]", () => {
    const f = scanContextKey(`password["${val}"]`);
    expect(f).toHaveLength(1);
    expect(f[0].matched).toBe(val);
  });

  it("detects dict access ['key'] = value", () => {
    const f = scanContextKey(`config["password"] = "${val}"`);
    expect(f).toHaveLength(1);
    expect(f[0].matched).toBe(val);
  });

  it("detects XML tag <key>value</key>", () => {
    const f = scanContextKey(`<password>${val}</password>`);
    expect(f).toHaveLength(1);
    expect(f[0].matched).toBe(val);
  });

  it("detects dot notation .key = value", () => {
    const f = scanContextKey(`config.password = "${val}"`);
    expect(f).toHaveLength(1);
    expect(f[0].matched).toBe(val);
  });

  it("detects URL query params without swallowing adjacent values", () => {
    const pwdVal = "k8s-Prod2024_Sec";
    const f = scanContextKey(`username=${val}&password=${pwdVal}`);
    expect(f).toHaveLength(2);
    expect(f.some((x) => x.matched === val)).toBe(true);
    expect(f.some((x) => x.matched === pwdVal)).toBe(true);
  });
});


describe("scanContextKey — endpoint config leakage", () => {
  const apiKey = "demo-key_1234567890";
  const endpoint = "https://api.example.test/v1";

  it("masks camelCase apiKey and baseUrl together", () => {
    const f = scanContextKey(`"apiKey": "${apiKey}", "baseUrl": "${endpoint}"`);
    expect(f.some((x) => x.matched === apiKey)).toBe(true);
    expect(f.some((x) => x.matched === endpoint)).toBe(true);
  });

  it("masks mixed-case APIKEY and BASEURL", () => {
    const f = scanContextKey(`APIKEY=${apiKey}\nBASEURL=${endpoint}`);
    expect(f.some((x) => x.matched === apiKey)).toBe(true);
    expect(f.some((x) => x.matched === endpoint)).toBe(true);
  });

  it("masks separator variants api-key and base_url", () => {
    const f = scanContextKey(`"api-key": "${apiKey}", "base_url": "${endpoint}"`);
    expect(f.some((x) => x.matched === apiKey)).toBe(true);
    expect(f.some((x) => x.matched === endpoint)).toBe(true);
  });

  it("masks reported bashUrl typo when paired with API key config", () => {
    const f = scanContextKey(`apiKey=${apiKey}\nbashUrl=${endpoint}`);
    expect(f.some((x) => x.matched === apiKey)).toBe(true);
    expect(f.some((x) => x.matched === endpoint)).toBe(true);
  });

  it("does not mask arbitrary prose URL without endpoint key context", () => {
    const f = scanContextKey(`Please read https://api.example.test/v1 before continuing.`);
    expect(f).toHaveLength(0);
  });

  it("masks full endpoint values that include URL query parameters", () => {
    const f = scanContextKey(
      `apiKey=demo-key_1234567890\nbaseUrl=https://api.example.test/v1?tenant=abc&region=us`
    );
    expect(f.some((x) => x.matched === "demo-key_1234567890")).toBe(true);
    expect(f.some((x) => x.matched === "https://api.example.test/v1?tenant=abc&region=us")).toBe(true);
  });
});
