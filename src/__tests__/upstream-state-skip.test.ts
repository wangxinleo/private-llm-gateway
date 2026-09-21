import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("@/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config")>();
  return { ...actual, DB_PATH: join(tmpdir(), `upstream-state-${process.pid}`, "audit.sqlite") };
});

import { getDb } from "@/audit/store";
import { bulkCreateWords } from "@/words/store";
import { maskJsonBody } from "@/scanner/json-mask";
import { runPipeline } from "@/scanner/pipeline";
import { MaskRegistry } from "@/scanner/mask-registry";

const tmpDir = join(tmpdir(), `upstream-state-${process.pid}`);
const PHONE = "13812345678";

const scanFn = (text: string, size: number, registry?: MaskRegistry) =>
  runPipeline(text, size, [], registry);

function maskBody(body: unknown) {
  const raw = JSON.stringify(body);
  const registry = new MaskRegistry();
  const result = maskJsonBody(raw, scanFn, registry);
  return { raw, result, parsed: JSON.parse(result.maskedBody) as Record<string, any> };
}

beforeEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  getDb();
});

describe("上游自产模型状态：跳过扫描（正例）", () => {
  it("Anthropic assistant thinking 文本中的手机号不改写", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "thinking", thinking: `用户的手机号 ${PHONE} 要记住` }] },
        { role: "user", content: [{ type: "text", text: "继续" }] },
      ],
    };
    const { raw, result, parsed } = maskBody(body);
    expect(parsed.messages[1].content[0].thinking).toBe(`用户的手机号 ${PHONE} 要记住`);
    expect(result.findings).toEqual([]);
    expect(result.maskedBody).toBe(raw);
  });

  it("Anthropic thinking 文本中的自定义词不改写", () => {
    bulkCreateWords([{ label: "PROJECT", value: "AcmeCorp", kind: "word", wholeWord: false, enabled: true }]);
    const body = {
      model: "claude-sonnet-4-5",
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "用户问的是 AcmeCorp 的部署方案" }] },
      ],
    };
    const { raw, result, parsed } = maskBody(body);
    expect(parsed.messages[0].content[0].thinking).toBe("用户问的是 AcmeCorp 的部署方案");
    expect(result.findings).toEqual([]);
    expect(result.maskedBody).toBe(raw);
  });

  it("Anthropic redacted_thinking 整块（含 signature）不改写", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [
        {
          role: "assistant",
          content: [{ type: "redacted_thinking", data: "EmVhbGx5IHNlY3JldA==", signature: `sig_${PHONE}_xyz` }],
        },
      ],
    };
    const { raw, result, parsed } = maskBody(body);
    expect(parsed.messages[0].content[0].signature).toBe(`sig_${PHONE}_xyz`);
    expect(result.findings).toEqual([]);
    expect(result.maskedBody).toBe(raw);
  });

  it("Chat assistant reasoning_content 不改写", () => {
    const body = {
      model: "deepseek-r1",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", reasoning_content: `记得 ${PHONE}`, content: "" },
      ],
    };
    const { raw, result, parsed } = maskBody(body);
    expect(parsed.messages[1].reasoning_content).toBe(`记得 ${PHONE}`);
    expect(result.findings).toEqual([]);
    expect(result.maskedBody).toBe(raw);
  });

  it("Responses input[].type=reasoning 项不改写", () => {
    const body = {
      model: "gpt-5",
      input: [
        {
          type: "reasoning",
          id: "rs_1",
          encrypted_content: "z".repeat(80),
          summary: [{ type: "summary_text", text: `记得 ${PHONE}` }],
        },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
    };
    const { raw, result, parsed } = maskBody(body);
    expect(parsed.input[0].summary[0].text).toBe(`记得 ${PHONE}`);
    expect(result.findings).toEqual([]);
    expect(result.maskedBody).toBe(raw);
  });
});

describe("上游自产模型状态：不跳过的反例", () => {
  it("Anthropic assistant 普通 text 块照常脱敏", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [
        { role: "assistant", content: [{ type: "text", text: `手机 ${PHONE}` }] },
      ],
    };
    const { result, parsed } = maskBody(body);
    expect(result.action).toBe("mask");
    expect(parsed.messages[0].content[0].text).toContain("{{PHONE_");
  });

  it("Anthropic assistant tool_use input 照常脱敏", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "lookup", input: { phone: PHONE } }],
        },
      ],
    };
    const { result, parsed } = maskBody(body);
    expect(result.action).toBe("mask");
    expect(parsed.messages[0].content[0].input.phone).toContain("{{PHONE_");
  });

  it("user 消息中的 type=thinking 块（非法形状）照常脱敏", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [
        { role: "user", content: [{ type: "thinking", thinking: `用户自己贴的 ${PHONE}` }] },
      ],
    };
    const { result, parsed } = maskBody(body);
    expect(result.action).toBe("mask");
    expect(parsed.messages[0].content[0].thinking).toContain("{{PHONE_");
  });

  it("user 消息中的 reasoning_content（非法形状）照常脱敏", () => {
    const body = {
      model: "deepseek-r1",
      messages: [{ role: "user", reasoning_content: `用户贴的 ${PHONE}`, content: "hi" }],
    };
    const { result, parsed } = maskBody(body);
    expect(result.action).toBe("mask");
    expect(parsed.messages[0].reasoning_content).toContain("{{PHONE_");
  });

  it("非 thinking 路径上的同名字段仍被扫描（字段名单独不构成豁免）", () => {
    const body = {
      model: "claude-sonnet-4-5",
      signature: `sig_${PHONE}_xyz`,
      messages: [{ role: "user", content: "hi" }],
    };
    const { result, parsed } = maskBody(body);
    expect(result.action).toBe("mask");
    expect(parsed.signature).toContain("{{PHONE_");
  });
});
