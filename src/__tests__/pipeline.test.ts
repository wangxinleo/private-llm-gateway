import { describe, it, expect } from "vitest";
import { runPipeline, getSizeTier } from "@/scanner/pipeline";

describe("getSizeTier", () => {
  it("< 128KB -> full", () => {
    expect(getSizeTier(127 * 1024)).toBe("full");
    expect(getSizeTier(0)).toBe("full");
  });

  it("128KB - 1MB -> chunked", () => {
    expect(getSizeTier(128 * 1024)).toBe("chunked");
    expect(getSizeTier(512 * 1024)).toBe("chunked");
    expect(getSizeTier(1024 * 1024 - 1)).toBe("chunked");
  });

  it("> 1MB -> minimal", () => {
    expect(getSizeTier(1024 * 1024)).toBe("minimal");
    expect(getSizeTier(10 * 1024 * 1024)).toBe("minimal");
  });
});

describe("runPipeline", () => {
  it("allows clean text", () => {
    const r = runPipeline("Hello, world!", 100);
    expect(r.action).toBe("allow");
    expect(r.findings).toHaveLength(0);
  });

  it("masks private key and forwards", () => {
    const text =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----";
    const r = runPipeline(text, 100);
    expect(r.action).toBe("mask");
    expect(r.findings.some((f) => f.category === "PRIVATE_KEY")).toBe(true);
    expect(r.maskedBody).toBe("<<PRIVACY_MASK:PRIVATE_KEY>>");
  });

  it("masks Bearer token and forwards", () => {
    const r = runPipeline("Authorization: Bearer abc123token", 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:BEARER_TOKEN>>");
    expect(r.maskedBody).not.toContain("abc123token");
  });

  it("masks DB URI and forwards", () => {
    const r = runPipeline("postgres://user:pass@host/db", 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:DB_URI>>");
    expect(r.maskedBody).not.toContain("user:pass@host");
  });

  it("masks PII but allows forward", () => {
    const r = runPipeline("手机号：13912345678", 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:PHONE>>");
    expect(r.maskedBody).not.toContain("13912345678");
  });

  it("masks email", () => {
    const r = runPipeline("contact: user@example.com", 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toBe("contact: <<PRIVACY_MASK:EMAIL>>");
  });

  it("masks ID card", () => {
    const r = runPipeline("身份证：330106200002020012", 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:ID_CARD>>");
  });

  it("masks secrets and PII together", () => {
    const text = "Bearer abc123token phone 13912345678";
    const r = runPipeline(text, 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:BEARER_TOKEN>>");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:PHONE>>");
    expect(r.maskedBody).not.toContain("abc123token");
    expect(r.maskedBody).not.toContain("13912345678");
  });

  it("filename block triggers immediate block", () => {
    const r = runPipeline("normal text", 100, ["id_rsa", "config.json"]);
    expect(r.action).toBe("block");
    expect(
      r.findings.some((f) => f.category === "SENSITIVE_FILENAME")
    ).toBe(true);
  });

  it("masks context key value and forwards", () => {
    const r = runPipeline(
      '"api_key": "aBcDeFgHiJkLmNoPqRsTuVwXyZ012"',
      100
    );
    expect(r.action).toBe("mask");
    expect(
      r.findings.some((f) => f.category === "CONTEXTUAL_SECRET")
    ).toBe(true);
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:CONTEXTUAL_SECRET>>");
    expect(r.maskedBody).not.toContain("aBcDeFgHiJkLmNoPqRsTuVwXyZ012");
  });

  it("blocks sensitive filename extension", () => {
    const r = runPipeline("upload", 100, ["secrets.pem"]);
    expect(r.action).toBe("block");
  });

  it("multiple PII findings all masked", () => {
    const r = runPipeline("phone 13912345678 email a@b.com", 100);
    expect(r.action).toBe("mask");
    expect(r.findings.length).toBeGreaterThanOrEqual(2);
    expect(r.maskedBody).not.toContain("13912345678");
    expect(r.maskedBody).not.toContain("a@b.com");
  });

  it("minimal tier (large body) catches secrets", () => {
    const text =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----";
    const r = runPipeline(text, 1024 * 1024 + 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:PRIVATE_KEY>>");
  });

  it("masks multiple secrets in same text", () => {
    const text = "Bearer abc123token and postgres://user:pass@host/db";
    const r = runPipeline(text, 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:BEARER_TOKEN>>");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:DB_URI>>");
  });

  it("block only happens for filename", () => {
    const r = runPipeline("Bearer abc123token", 100);
    expect(r.action).toBe("mask");
    expect(r.action).not.toBe("block");
  });

  it("masks AWS key", () => {
    const r = runPipeline("key=AKIAIOSFODNN7EXAMPLE", 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:AWS_ACCESS_KEY>>");
  });

  it("masks GitHub token", () => {
    const r = runPipeline(
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
      100
    );
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:GITHUB_TOKEN>>");
  });

  it("masks Slack token", () => {
    const r = runPipeline("xoxb-1234567890-abcdefghijk", 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:SLACK_TOKEN>>");
  });

  it("masks Google API key", () => {
    const r = runPipeline("AIzaSyA1234567890abcdefghijklmnopqrstuvwx", 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:GOOGLE_API_KEY>>");
  });

  it("masks raw API key and endpoint config text", () => {
    const r = runPipeline(
      "APIKEY=demo-key_1234567890\nBASEURL=https://api.example.test/v1",
      100
    );
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("APIKEY=<<PRIVACY_MASK:CONTEXTUAL_SECRET>>");
    expect(r.maskedBody).toContain("BASEURL=<<PRIVACY_MASK:CONTEXTUAL_SECRET>>");
    expect(r.maskedBody).not.toContain("demo-key_1234567890");
    expect(r.maskedBody).not.toContain("https://api.example.test/v1");
  });

  it("does not mask ordinary prose URLs without endpoint key context", () => {
    const r = runPipeline("See https://api.example.test/v1 for public docs", 100);
    expect(r.action).toBe("allow");
    expect(r.maskedBody).toBe("See https://api.example.test/v1 for public docs");
  });

});
