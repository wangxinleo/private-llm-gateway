import { describe, it, expect } from "vitest";
import { runPipeline } from "@/scanner/pipeline";
import { MaskRegistry } from "@/scanner/mask-registry";

// 高风险资产白名单已下线:窗口扫描锚点 = 敏感键值对(api_key/password/token 等)
const ANCHOR = 'api_key = aBcDeFgHiJkLmNoPqRsTuVwXyZ01234';

describe("runPipeline — anchor-gated window scanning", () => {
  it("allows clean text", () => {
    const r = runPipeline("Hello, world!", 100);
    expect(r.action).toBe("allow");
    expect(r.findings).toHaveLength(0);
  });

  it("allows secrets without anchor", () => {
    const r = runPipeline("the token abc123token appears in prose without context", 100);
    expect(r.action).toBe("allow");
    expect(r.findings).toHaveLength(0);
  });

  it("allows emails without anchor", () => {
    const r = runPipeline("contact: user@example.com", 100);
    expect(r.action).toBe("allow");
    expect(r.findings).toHaveLength(0);
  });

  it("masks secrets inside anchor window", () => {
    const r = runPipeline(`${ANCHOR} token Bearer abc123token4567890xyz`, 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:BEARER_TOKEN>>");
    expect(r.maskedBody).not.toContain("abc123token");
  });

  it("masks email inside anchor window", () => {
    const r = runPipeline(`${ANCHOR} mail user@example.com`, 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:EMAIL>>");
  });

  it("masks private key inside anchor window", () => {
    const text = `${ANCHOR}\n-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----`;
    const r = runPipeline(text, 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:PRIVATE_KEY>>");
  });

  it("masks DB URI inside anchor window", () => {
    const r = runPipeline(`${ANCHOR} db postgres://user:pass@host/db`, 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:DB_URI>>");
  });

  it("masks AWS key inside anchor window", () => {
    const r = runPipeline(`${ANCHOR} key=AKIAIOSFODNN7EXAMPLE`, 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:AWS_ACCESS_KEY>>");
  });

  it("masks GitHub token inside anchor window", () => {
    const r = runPipeline(`${ANCHOR} ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij`, 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:GITHUB_TOKEN>>");
  });

  it("masks context key value inside anchor window", () => {
    const r = runPipeline(`${ANCHOR} "api_key": "aBcDeFgHiJkLmNoPqRsTuVwXyZ012"`, 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:CONTEXTUAL_SECRET>>");
  });

  it("registry round-trips masked values for response restore", () => {
    const registry = new MaskRegistry();
    const r = runPipeline(`${ANCHOR} token Bearer abc123token4567890xyz`, 100, [], registry);
    expect(r.action).toBe("mask");
    const tag = r.maskedBody.match(/\{\{BEARER_[bcdfghjkmnpqrstvwxz]{5}\}\}/)?.[0] ?? "";
    expect(registry.tagToValue.get(tag)).toBe("Bearer abc123token4567890xyz");
  });
});
