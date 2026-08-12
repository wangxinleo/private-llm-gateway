import { describe, it, expect } from "vitest";
import { scanPii, applyMasks } from "@/scanner/pii";
import type { Finding } from "@/types";

describe("scanPii", () => {
  it("detects phone and returns explicit maskTag", () => {
    const f = scanPii("call 13912345678 later");
    expect(f.some((x) => x.category === "PHONE")).toBe(true);
    expect(f.find((x) => x.category === "PHONE")?.maskTag).toBe("<<PRIVACY_MASK:PHONE>>");
  });

  it("detects email and returns explicit maskTag", () => {
    const f = scanPii("send to test@example.com please");
    expect(f.some((x) => x.category === "EMAIL")).toBe(true);
    expect(f.find((x) => x.category === "EMAIL")?.maskTag).toBe("<<PRIVACY_MASK:EMAIL>>");
  });

  it("detects ID card", () => {
    const f = scanPii("ID: 110101199003073458");
    expect(f.some((x) => x.category === "ID_CARD")).toBe(true);
    expect(f.find((x) => x.category === "ID_CARD")?.maskTag).toBe("<<PRIVACY_MASK:ID_CARD>>");
  });

  it("action is always mask", () => {
    const f = scanPii("phone: 13912345678, email: test@example.com");
    expect(f.every((x) => x.action === "mask")).toBe(true);
  });

  it("returns empty for clean text", () => {
    expect(scanPii("Hello world, no PII here.")).toHaveLength(0);
  });

  // 真实请求的工具输出含长 base64/token 串,EMAIL 正则 local part 贪婪匹配失败
  // 曾触发 O(n²) 回溯(scanPii 1062ms);lookbehind 边界修复后必须保持有界。
  it("completes on base64/token 长文本 within bounded time", () => {
    const chunks: string[] = [];
    for (let i = 0; i < 200; i++) {
      chunks.push(`token_${"A".repeat(120)}${i} ${"B".repeat(90)}${i} `);
    }
    const text = chunks.join("");

    const start = performance.now();
    const f = scanPii(text);
    const elapsed = performance.now() - start;

    expect(f).toHaveLength(0);
    expect(elapsed).toBeLessThan(200);
  });
});

describe("applyMasks", () => {
  it("replaces phone with explicit tag and counts replacements", () => {
    const text = "call 13912345678 later";
    const findings = scanPii(text);
    const result = applyMasks(text, findings);
    expect(result.masked).toBe("call <<PRIVACY_MASK:PHONE>> later");
    expect(result.replacementCount).toBe(1);
  });

  it("replaces email with explicit tag", () => {
    const text = "send to test@example.com please";
    const findings = scanPii(text);
    const result = applyMasks(text, findings);
    expect(result.masked).toContain("<<PRIVACY_MASK:EMAIL>>");
  });

  it("handles multiple PII in same text", () => {
    const text = "phone 13912345678 email test@example.com";
    const findings = scanPii(text);
    const result = applyMasks(text, findings);
    expect(result.masked).toContain("<<PRIVACY_MASK:PHONE>>");
    expect(result.masked).toContain("<<PRIVACY_MASK:EMAIL>>");
    expect(result.replacementCount).toBeGreaterThanOrEqual(2);
  });

  it("ignores non-mask findings", () => {
    const text = "some text";
    const fakeFindings: Finding[] = [
      { category: "PRIVATE_KEY", action: "block", matched: "PRIVATE_KEY" },
    ];
    const result = applyMasks(text, fakeFindings);
    expect(result.masked).toBe(text);
    expect(result.replacementCount).toBe(0);
  });

  it("counts repeated matched values", () => {
    const email = "test@example.com";
    const text = `${email} and ${email} again`;
    const findings: Finding[] = [
      {
        category: "EMAIL",
        action: "mask",
        matched: email,
        maskTag: "<<PRIVACY_MASK:EMAIL>>",
      },
    ];
    const result = applyMasks(text, findings);
    expect(result.replacementCount).toBe(2);
  });
});
