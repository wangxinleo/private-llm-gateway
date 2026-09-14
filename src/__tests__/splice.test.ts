import { describe, expect, it } from "vitest";
import { maskJsonBody } from "@/scanner/json-mask";
import { runPipeline } from "@/scanner/pipeline";
import { MaskRegistry } from "@/scanner/mask-registry";

function makeScan(registry?: MaskRegistry) {
  return (text: string, size: number) => runPipeline(text, size, [], registry);
}

describe("byte-level splice (R2)", () => {
  it("preserves original formatting around masked values (prompt-cache prefix fidelity)", () => {
    const registry = new MaskRegistry();
    // 刻意使用非常规排版:多余空格、换行、非紧凑分隔
    const body = `{  "model" :  "gpt-4o" ,\n  "messages" : [ { "role" : "user" , "content" : "联系 13800138000 备注 ok" } ]  }`;
    const result = maskJsonBody(body, makeScan(registry), registry);
    expect(result.action).toBe("mask");

    // 非敏感前缀逐字节保留(旧 stringify 行为会把它改写成紧凑体)
    const sensitivePos = body.indexOf("13800138000");
    expect(result.maskedBody.startsWith(body.slice(0, sensitivePos))).toBe(true);
    // 占位符就位,原文消失
    expect(result.maskedBody).not.toContain("13800138000");
    expect(result.maskedBody).toMatch(/\{\{PHONE_[bcdfghjkmnpqrstvwxz]{5}\}\}/);
    // 仍是合法 JSON 且结构一致
    const parsed = JSON.parse(result.maskedBody);
    expect(parsed.messages[0].content).toContain("联系");
  });

  it("splices \\uXXXX-escaped non-ASCII values (plate detector) in the raw body", () => {
    const registry = new MaskRegistry();
    const escapedPlate = "\\u4eacA12345"; // 京A12345
    const body = `{"messages":[{"role":"user","content":"车牌 ${escapedPlate} 开走"}]}`;
    const result = maskJsonBody(body, makeScan(registry), registry);
    expect(result.action).toBe("mask");
    expect(result.maskedBody).not.toContain("京A12345");
    expect(JSON.parse(result.maskedBody).messages[0].content).toMatch(/\{\{PLATE_[bcdfghjkmnpqrstvwxz]{5}\}\}/);
  });

  it("falls back to re-serialization when spurious replacement breaks equivalence", () => {
    const registry = new MaskRegistry();
    // 敏感值同时出现在键名里:splice 必然多替换 → 深等价校验拒绝 → 退回 stringify。
    // 键名不在脱敏范围(既有语义):回退后键名原样、值侧已脱敏。
    const body = `{"user_13800138000":"meta","messages":[{"role":"user","content":"call 13800138000"}]}`;
    const result = maskJsonBody(body, makeScan(registry), registry);
    expect(result.action).toBe("mask");
    const parsed = JSON.parse(result.maskedBody);
    expect(parsed.user_13800138000).toBe("meta");
    expect(parsed.messages[0].content).toMatch(/\{\{PHONE_[bcdfghjkmnpqrstvwxz]{5}\}\}/);
  });

  it("allow path returns the original body bytes (no re-serialization)", () => {
    const body = `{  "loose" :  "formatting"  ,  "n" : 1  }`;
    const result = maskJsonBody(body, makeScan(new MaskRegistry()));
    expect(result.action).toBe("allow");
    expect(result.maskedBody).toBe(body);
  });

  it("masks correctly when client uses \\u escapes for ascii values (fallback path)", () => {
    const registry = new MaskRegistry();
    const escapedPhone = Array.from("13800138000").map((c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
    const body = `{"messages":[{"role":"user","content":"${escapedPhone}"}]}`;
    const result = maskJsonBody(body, makeScan(registry), registry);
    expect(result.action).toBe("mask");
    expect(JSON.parse(result.maskedBody).messages[0].content).toMatch(/\{\{PHONE_[bcdfghjkmnpqrstvwxz]{5}\}\}/);
  });
});
