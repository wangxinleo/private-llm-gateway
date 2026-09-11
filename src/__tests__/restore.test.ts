import { describe, it, expect } from "vitest";
import { MaskRegistry } from "@/scanner/mask-registry";
import { SseChannelRestorer, restoreText } from "@/proxy/restore";
import { createStreamingResponse } from "@/proxy/streaming";

const SUFFIXES = ["trwmq", "bcdfg", "knpqr"];

function makeRegistry(): MaskRegistry {
  let n = 0;
  return new MaskRegistry(() => SUFFIXES[n++ % SUFFIXES.length]);
}

function makeLoadedRegistry() {
  const registry = makeRegistry();
  const phone = registry.tagFor("PHONE", "13912345678");
  const email = registry.tagFor("EMAIL", "a@b.com");
  return { registry, phone, email };
}

const ENCODER = new TextEncoder();

function sseFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function frameWithContent(content: string): string {
  return sseFrame({ choices: [{ delta: { content } }] });
}

function payloadOf(output: string): unknown {
  return JSON.parse(output.replace(/^data: /, "").replace(/\n\n$/, ""));
}

describe("restoreText", () => {
  it("restores issued v3 tags via the registry", () => {
    const { registry, phone } = makeLoadedRegistry();
    expect(restoreText(`call ${phone} now`, registry)).toBe("call 13912345678 now");
  });

  it("passes legacy and explicit formats through untouched", () => {
    const { registry } = makeLoadedRegistry();
    const text = "[PHONE] and <<PRIVACY_MASK:EMAIL>>";
    expect(restoreText(text, registry)).toBe(text);
  });

  it("passes grammar-valid but unissued tags through verbatim", () => {
    const { registry } = makeLoadedRegistry();
    const text = "{{PHONE_TRWMQ}} stays";
    expect(restoreText(text, registry)).toBe(text);
  });

  it("loose-repairs stripped braces and counts degraded separately", () => {
    const { registry } = makeLoadedRegistry();
    const stats = { degraded: 0 };
    expect(restoreText("{PHONE_trwmq} and PHONE_trwmq", registry, stats)).toBe(
      "13912345678 and 13912345678"
    );
    expect(stats.degraded).toBe(2);
  });

  it("does not count strict hits as degraded", () => {
    const { registry, phone } = makeLoadedRegistry();
    const stats = { degraded: 0 };
    expect(restoreText(`call ${phone}`, registry, stats)).toBe("call 13912345678");
    expect(stats.degraded).toBe(0);
  });

  it("never guesses unissued loose tokens and leaves them verbatim", () => {
    const { registry } = makeLoadedRegistry();
    const stats = { degraded: 0 };
    const text = "PHONE_zzzzq {{PHONE_zzzzq}}";
    expect(restoreText(text, registry, stats)).toBe(text);
    expect(stats.degraded).toBe(0);
  });
});

describe("SseChannelRestorer", () => {
  it("restores a tag fed one byte at a time", () => {
    const { registry, phone } = makeLoadedRegistry();
    const restorer = new SseChannelRestorer(registry);
    const bytes = ENCODER.encode(frameWithContent(`hi ${phone} bye`));
    const decoder = new TextDecoder();
    let out = "";
    for (const byte of bytes) {
      out += restorer.pushBytes(decoder.decode(new Uint8Array([byte]), { stream: true }));
    }
    out += restorer.flush();
    expect((payloadOf(out) as { choices: [{ delta: { content: string } }] }).choices[0].delta.content).toBe(
      "hi 13912345678 bye"
    );
  });

  it("splices a placeholder split across two separate data frames via per-channel pending", () => {
    const { registry, phone } = makeLoadedRegistry();
    const restorer = new SseChannelRestorer(registry);
    const out1 = restorer.pushBytes(frameWithContent(phone.slice(0, 5)));
    const out2 = restorer.pushBytes(frameWithContent(`${phone.slice(5)} done`));
    expect((payloadOf(out1) as { choices: [{ delta: { content: string } }] }).choices[0].delta.content).toBe("");
    expect((payloadOf(out2) as { choices: [{ delta: { content: string } }] }).choices[0].delta.content).toBe(
      `13912345678 done`
    );
    expect(out1 + out2).not.toContain("{{");
  });

  it("releases fake prefixes like {{ user.name }} immediately", () => {
    const { registry } = makeLoadedRegistry();
    const restorer = new SseChannelRestorer(registry);
    const text = "x {{ user.name }} y";
    const out = restorer.pushBytes(frameWithContent(text));
    expect((payloadOf(out) as { choices: [{ delta: { content: string } }] }).choices[0].delta.content).toBe(text);
    expect(restorer.flush()).toBe("");
  });

  it("flushes residual pending through the last frame template at EOF", () => {
    const { registry } = makeLoadedRegistry();
    const restorer = new SseChannelRestorer(registry);
    const out1 = restorer.pushBytes(frameWithContent("answer {{EMAIL_B"));
    expect((payloadOf(out1) as { choices: [{ delta: { content: string } }] }).choices[0].delta.content).toBe(
      "answer "
    );
    const tail = restorer.flush();
    expect(tail.startsWith("data: ")).toBe(true);
    expect((payloadOf(tail) as { choices: [{ delta: { content: string } }] }).choices[0].delta.content).toBe(
      "{{EMAIL_B"
    );
    expect(restorer.flush()).toBe("");
  });

  it("restores adjacent tags in one frame", () => {
    const { registry, phone, email } = makeLoadedRegistry();
    const restorer = new SseChannelRestorer(registry);
    const out = restorer.pushBytes(frameWithContent(`${phone}${email}`));
    expect((payloadOf(out) as { choices: [{ delta: { content: string } }] }).choices[0].delta.content).toBe(
      "13912345678a@b.com"
    );
  });

  it("passes malformed JSON frames through verbatim", () => {
    const { registry } = makeLoadedRegistry();
    const restorer = new SseChannelRestorer(registry);
    const frame = "data: {oops not json";
    expect(restorer.pushBytes(`${frame}\n\n`)).toBe(`${frame}\n\n`);
  });

  it("passes non-data frames and [DONE] through verbatim", () => {
    const { registry } = makeLoadedRegistry();
    const restorer = new SseChannelRestorer(registry);
    expect(restorer.pushBytes("event: ping\n\n")).toBe("event: ping\n\n");
    expect(restorer.pushBytes(": keep-alive\n\n")).toBe(": keep-alive\n\n");
    expect(restorer.pushBytes("data: [DONE]\n\n")).toBe("data: [DONE]\n\n");
  });

  it("isolates channels: content and tool_calls arguments restore independently", () => {
    const { registry, phone, email } = makeLoadedRegistry();
    const restorer = new SseChannelRestorer(registry);
    const frame1 = sseFrame({
      choices: [
        {
          delta: {
            content: phone.slice(0, 5),
            tool_calls: [{ function: { arguments: `{"k":"${email.slice(0, 10)}` } }],
          },
        },
      ],
    });
    const frame2 = sseFrame({
      choices: [
        {
          delta: {
            content: `${phone.slice(5)}!`,
            tool_calls: [{ function: { arguments: `${email.slice(10)}"}` } }],
          },
        },
      ],
    });
    const out1 = restorer.pushBytes(frame1);
    const out2 = restorer.pushBytes(frame2);
    const p1 = payloadOf(out1) as {
      choices: [{ delta: { content: string; tool_calls: [{ function: { arguments: string } }] } }];
    };
    const p2 = payloadOf(out2) as {
      choices: [{ delta: { content: string; tool_calls: [{ function: { arguments: string } }] } }];
    };
    expect(p1.choices[0].delta.content).toBe("");
    expect(p1.choices[0].delta.tool_calls[0].function.arguments).toBe('{"k":"');
    expect(p2.choices[0].delta.content).toBe("13912345678!");
    expect(p2.choices[0].delta.tool_calls[0].function.arguments).toBe('a@b.com"}');
    expect(out1 + out2).not.toContain("{{");
  });

  it("does not splice one channel's pending with another channel's text", () => {
    const { registry, phone } = makeLoadedRegistry();
    const restorer = new SseChannelRestorer(registry);
    const frame1 = frameWithContent(phone.slice(0, 5));
    const frame2 = sseFrame({
      choices: [{ delta: { content: "", tool_calls: [{ function: { arguments: `${phone.slice(5)}X` } }] } }],
    });
    const out1 = restorer.pushBytes(frame1);
    const out2 = restorer.pushBytes(frame2);
    const p2 = payloadOf(out2) as {
      choices: [{ delta: { content: string; tool_calls: [{ function: { arguments: string } }] } }];
    };
    expect(out1).not.toContain("13912345678");
    expect(p2.choices[0].delta.tool_calls[0].function.arguments).toBe(`${phone.slice(5)}X`);
    const tail = restorer.flush();
    expect(tail).toContain(phone.slice(0, 5));
  });

  it("handles fake-tag floods in linear time", () => {
    const { registry } = makeLoadedRegistry();
    const restorer = new SseChannelRestorer(registry);
    const flood = "{{AAAA".repeat(40000);
    const start = performance.now();
    const out = restorer.pushBytes(frameWithContent(flood));
    const elapsed = performance.now() - start;
    restorer.flush();
    expect(out.startsWith("data: ")).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  });

  it("restores CJK content split across pushes", () => {
    const { registry, phone } = makeLoadedRegistry();
    const restorer = new SseChannelRestorer(registry);
    const out1 = restorer.pushBytes(frameWithContent(`你好 ${phone.slice(0, 7)}`));
    const out2 = restorer.pushBytes(frameWithContent(phone.slice(7)));
    expect(out1).toContain("你好");
    expect((payloadOf(out2) as { choices: [{ delta: { content: string } }] }).choices[0].delta.content).toBe(
      "13912345678"
    );
  });
});

describe("createStreamingResponse with restorer", () => {
  async function readAll(response: Response): Promise<string> {
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return chunks.map((c) => new TextDecoder().decode(c)).join("");
  }

  it("restores frames and flushes residual before close", async () => {
    const { registry, phone, email } = makeLoadedRegistry();
    const restorer = new SseChannelRestorer(registry);
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(ENCODER.encode(frameWithContent(`see ${phone.slice(0, 6)}`)));
        controller.enqueue(ENCODER.encode(frameWithContent(`${phone.slice(6)} ok`)));
        controller.enqueue(ENCODER.encode(frameWithContent("tail {{EMAIL_B")));
        controller.enqueue(ENCODER.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const upstream = new Response(upstreamBody, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const result = createStreamingResponse(upstream, restorer);
    const text = await readAll(result);
    const frames = text.split("\n\n").filter(Boolean);
    const contents = frames
      .filter((f) => f.startsWith("data: ") && !f.includes("[DONE]"))
      .map((f) => (payloadOf(f) as { choices: [{ delta: { content: string } }] }).choices[0].delta.content);
    expect(contents[0]).toBe("see ");
    expect(contents[1]).toBe("13912345678 ok");
    expect(contents[2]).toBe("tail ");
    expect(contents[3]).toBe("{{EMAIL_B");
    expect(text).toContain("data: [DONE]\n\n");
    expect(text.endsWith("\n\n")).toBe(true);
  });

  it("decodes multibyte UTF-8 split across a byte chunk boundary", async () => {
    const { registry, phone } = makeLoadedRegistry();
    const restorer = new SseChannelRestorer(registry);
    const prefix = 'data: {"choices":[{"delta":{"content":"';
    const bytes = ENCODER.encode(frameWithContent(`你好 ${phone} 再见`));
    const splitAt = ENCODER.encode(prefix).length + 1;
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        controller.close();
      },
    });
    const upstream = new Response(upstreamBody, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const text = await readAll(createStreamingResponse(upstream, restorer));
    expect((payloadOf(text) as { choices: [{ delta: { content: string } }] }).choices[0].delta.content).toBe(
      `你好 13912345678 再见`
    );
  });
});
