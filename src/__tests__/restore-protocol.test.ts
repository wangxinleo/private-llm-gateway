import { describe, expect, it } from "vitest";
import { SseChannelRestorer } from "@/proxy/restore";
import { MaskRegistry } from "@/scanner/mask-registry";

function makeRestorer(): { restorer: SseChannelRestorer; phone: string; email: string } {
  const registry = new MaskRegistry();
  const phone = registry.tagFor("PHONE", "13800138000");
  const email = registry.tagFor("EMAIL", "foo@bar.com");
  return { restorer: new SseChannelRestorer(registry), phone, email };
}

function data(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function extractTexts(output: string): string[] {
  const texts: string[] = [];
  for (const frame of output.split("\n\n")) {
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5);
      if (payload.trim() === "[DONE]") continue;
      try {
        texts.push(JSON.stringify(JSON.parse(payload)));
      } catch {
        texts.push(payload);
      }
    }
  }
  return texts;
}

describe("chat completions: semantic choice index", () => {
  it("sparse chunks with index≠position keep choices isolated", () => {
    const { restorer, phone, email } = makeRestorer();
    const halfP = phone.slice(0, 8);
    const halfE = email.slice(0, 8);
    let out = "";
    out += restorer.pushBytes(data({ choices: [{ index: 1, delta: { content: halfP } }] }));
    out += restorer.pushBytes(data({ choices: [{ index: 0, delta: { content: halfE } }] }));
    out += restorer.pushBytes(data({ choices: [{ index: 1, delta: { content: phone.slice(8) } }] }));
    out += restorer.pushBytes(data({ choices: [{ index: 0, delta: { content: email.slice(8) } }] }));
    const texts = extractTexts(out).join("\n");
    expect(texts).toContain("13800138000");
    expect(texts).toContain("foo@bar.com");
    expect(texts).not.toContain("{{");
  });

  it("finish_reason flushes only that choice's withheld text as a synthetic delta", () => {
    const { restorer, phone } = makeRestorer();
    let out = "";
    out += restorer.pushBytes(data({ choices: [{ index: 0, delta: { content: phone.slice(0, 8) } }] }));
    out += restorer.pushBytes(data({ choices: [{ index: 1, delta: { content: "ok" } }] }));
    out += restorer.pushBytes(data({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
    // choice 0 的滞留文本在 finish_reason 帧后立即补发(无法还原的半截 tag 按原样发出,不丢字)
    expect(out).toContain("{{PHONE_");
    // choice 1 未终态前无滞留:其 finish_reason 帧正常透传,不再补发 choice 0 的内容
    const tail = restorer.pushBytes(data({ choices: [{ index: 1, delta: {}, finish_reason: "stop" }] }));
    expect(tail).toContain("finish_reason");
    expect(tail).not.toContain("{{PHONE_");
  });

  it("half-placeholder split across two chunks is buffered and restored", () => {
    const { restorer, phone } = makeRestorer();
    const out1 = restorer.pushBytes(data({ choices: [{ index: 0, delta: { content: phone.slice(0, 5) } }] }));
    expect(out1).toBe("data: " + JSON.stringify({ choices: [{ index: 0, delta: { content: "" } }] }) + "\n\n");
    const out2 = restorer.pushBytes(data({ choices: [{ index: 0, delta: { content: phone.slice(5) } }] }));
    expect(out2).toContain("13800138000");
  });
});

describe("anthropic: block-index channels with event: lines", () => {
  it("interleaved blocks stay isolated and event: line is preserved", () => {
    const { restorer, phone } = makeRestorer();
    let out = "";
    out += restorer.pushBytes(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: phone.slice(0, 8) } })}\n\n`);
    out += restorer.pushBytes(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "block1 text" } })}\n\n`);
    out += restorer.pushBytes(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: phone.slice(8) } })}\n\n`);

    expect(out).toContain("event: content_block_delta");
    expect(out).toContain("13800138000");
    expect(out).toContain("block1 text");
    expect(out).not.toContain("{{");
  });

  it("content_block_stop flushes only that block; message_stop flushes all", () => {
    const { restorer, phone } = makeRestorer();
    let out = "";
    out += restorer.pushBytes(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: phone.slice(0, 8) } })}\n\n`);
    const stopFrame = restorer.pushBytes(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
    // 滞留文本在 content_block_stop 时补发(半截 tag 原样,不丢字)
    expect(stopFrame).toContain("{{PHONE_");
    out += stopFrame;
    // 流尾 flush:该通道已清空,不再补发
    expect(restorer.flush()).toBe("");
  });
});

describe("responses: content_index channels and .done snapshots", () => {
  it("multiple content parts use separate channels", () => {
    const { restorer, phone, email } = makeRestorer();
    let out = "";
    out += restorer.pushBytes(data({ type: "response.output_text.delta", output_index: 0, delta: phone.slice(0, 8) }));
    out += restorer.pushBytes(data({ type: "response.output_text.delta", output_index: 0, content_index: 1, delta: email.slice(0, 8) }));
    out += restorer.pushBytes(data({ type: "response.output_text.delta", output_index: 0, delta: phone.slice(8) }));
    out += restorer.pushBytes(data({ type: "response.output_text.delta", output_index: 0, content_index: 1, delta: email.slice(8) }));
    const texts = extractTexts(out).join("\n");
    expect(texts).toContain("13800138000");
    expect(texts).toContain("foo@bar.com");
  });

  it(".done snapshot is restored and no synthetic delta is emitted afterwards", () => {
    const { restorer, phone } = makeRestorer();
    let out = "";
    out += restorer.pushBytes(data({ type: "response.output_text.delta", output_index: 4, delta: phone.slice(0, 8) }));
    out += restorer.pushBytes(data({ type: "response.output_text.done", output_index: 4, text: phone }));
    out += restorer.pushBytes(data({ type: "response.completed", response: {} }));
    out += restorer.flush();

    const texts = extractTexts(out).join("\n");
    // 快照已还原,且滞留半截占位符被丢弃——不产生重复补发
    expect(texts).toContain("13800138000");
    expect(texts.split("13800138000").length - 1).toBe(1);
    expect(out).not.toContain("{{PHONE_");
  });
});

describe("robustness", () => {
  it("parse-failed frames pass through untouched", () => {
    const { restorer } = makeRestorer();
    const frame = "data: {oops not json";
    expect(restorer.pushBytes(frame + "\n\n")).toBe(frame + "\n\n");
  });

  it("unknown shapes fall back to JSON-path channels (current behavior)", () => {
    const { restorer, phone } = makeRestorer();
    const out = restorer.pushBytes(data({ foo: { bar: phone } }));
    expect(out).toContain("13800138000");
  });

  it("[DONE] and comment/keepalive frames pass through", () => {
    const { restorer } = makeRestorer();
    expect(restorer.pushBytes("data: [DONE]\n\n")).toBe("data: [DONE]\n\n");
    expect(restorer.pushBytes("event: ping\n\n")).toBe("event: ping\n\n");
  });

  it("stream-end flush emits remaining withheld text with template", () => {
    const { restorer, phone } = makeRestorer();
    let out = "";
    out += restorer.pushBytes(data({ choices: [{ index: 0, delta: { content: phone.slice(0, 8) } }] }));
    out += restorer.flush();
    // 滞留半截 tag 无法还原,经模板补发原样文本,不丢字
    expect(out).toContain("{{PHONE_");
    expect(restorer.flush()).toBe("");
  });
});
