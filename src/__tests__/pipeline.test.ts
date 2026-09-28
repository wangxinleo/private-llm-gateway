import { describe, it, expect } from "vitest";
import { runPipeline } from "@/scanner/pipeline";
import { MaskRegistry } from "@/scanner/mask-registry";

// 高风险资产白名单已下线:窗口扫描锚点 = 敏感键值对(api_key/password/token 等)
const ANCHOR = 'api_key = aBcDeFgHiJkLmNoPqRsTuVwXyZ01234';

// 确定性 suffix:精确断言 {{LABEL_bcdfg}};每用例独立 registry 避免同类别多值随机兜底
const run = (text: string, registry = new MaskRegistry(() => "bcdfg")) =>
  runPipeline(text, 100, [], registry);

describe("runPipeline — anchor-gated window scanning", () => {
  it("allows clean text", () => {
    const r = run("Hello, world!");
    expect(r.action).toBe("allow");
    expect(r.findings).toHaveLength(0);
  });

  it("allows secrets without anchor", () => {
    const r = run("the token abc123token appears in prose without context");
    expect(r.action).toBe("allow");
    expect(r.findings).toHaveLength(0);
  });

  it("allows emails without anchor", () => {
    const r = run("contact: user@example.com");
    expect(r.action).toBe("allow");
    expect(r.findings).toHaveLength(0);
  });

  it("masks secrets inside anchor window", () => {
    const r = run(`${ANCHOR} token Bearer abc123token4567890xyz`);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("{{BEARER_bcdfg}}");
    expect(r.maskedBody).not.toContain("abc123token");
  });

  it("masks email inside anchor window", () => {
    const r = run(`${ANCHOR} mail user@example.com`);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("{{EMAIL_bcdfg}}");
  });

  it("masks private key inside anchor window", () => {
    const text = `${ANCHOR}\n-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----`;
    const r = run(text);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("{{PRIVATE_KEY_bcdfg}}");
  });

  it("masks DB URI inside anchor window", () => {
    const r = run(`${ANCHOR} db postgres://user:pass@host/db`);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("{{DB_URI_bcdfg}}");
  });

  it("masks AWS key inside anchor window", () => {
    const r = run(`${ANCHOR} key=AKIAIOSFODNN7EXAMPLE`);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("{{AWS_KEY_bcdfg}}");
  });

  it("masks GitHub token inside anchor window", () => {
    const r = run(`${ANCHOR} ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij`);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("{{GITHUB_bcdfg}}");
  });

  it("masks context key value inside anchor window", () => {
    const r = run(`${ANCHOR} "api_key": "aBcDeFgHiJkLmNoPqRsTuVwXyZ012"`);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toMatch(/\{\{SECRET_[bcdfghjkmnpqrstvwxz]{5}\}\}/);
  });

  it("registry round-trips masked values for response restore", () => {
    const registry = new MaskRegistry();
    const r = runPipeline(`${ANCHOR} token Bearer abc123token4567890xyz`, 100, [], registry);
    expect(r.action).toBe("mask");
    const tag = r.maskedBody.match(/\{\{BEARER_[bcdfghjkmnpqrstvwxz]{5}\}\}/)?.[0] ?? "";
    expect(registry.tagToValue.get(tag)).toBe("Bearer abc123token4567890xyz");
  });
});
