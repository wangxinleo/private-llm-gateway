import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { maskJsonBody } from "@/scanner/json-mask";
import { runPipeline } from "@/scanner/pipeline";

const scan = (text: string) => runPipeline(text, text.length);

/** 构造一个真实 PNG 的 base64,并在前部注入 `eyJ`+45 字符来强制触发 BASE64_TOKEN 规则。 */
function pngBase64WithEyJ(seed = 0): string {
  function crc32(buf: Buffer): Buffer {
    let c: number;
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return Buffer.from([(crc ^ 0xffffffff) >>> 24 & 0xff, (crc ^ 0xffffffff) >>> 16 & 0xff, (crc ^ 0xffffffff) >>> 8 & 0xff, (crc ^ 0xffffffff) & 0xff]);
  }
  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, "ascii");
    return Buffer.concat([len, typeBuf, data, crc32(Buffer.concat([typeBuf, data]))]);
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(64, 0);
  ihdr.writeUInt32BE(64, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(64 * (1 + 64 * 3));
  let p = 0;
  let state = (seed * 2654435761) >>> 0;
  for (let i = 0; i < raw.length; i++) {
    if (i % (1 + 64 * 3) === 0) { raw[p++] = 0; continue; }
    state = (state * 1664525 + 1013904223) >>> 0;
    raw[p++] = (state >>> 24) & 0xff;
  }
  const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  const b64 = png.toString("base64");
  const evil = "eyJ" + "A".repeat(45);
  return b64.slice(0, 20) + evil + b64.slice(20);
}

describe("image base64 payloads are not scanned as text (R1/R2)", () => {
  it("OpenAI image_url.url data URI with embedded eyJ+45 passes through byte-identical", () => {
    const body = JSON.stringify({
      model: "gpt-5.5",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${pngBase64WithEyJ()}` } },
          ],
        },
      ],
      max_tokens: 1000,
    });

    const result = maskJsonBody(body, scan);
    expect(result.action).toBe("allow");
    expect(result.findings).toEqual([]);
    expect(result.maskedBody).toBe(body);
  });

  it("Anthropic source.data raw base64 with embedded eyJ+45 passes through byte-identical", () => {
    const body = JSON.stringify({
      model: "claude-sonnet",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: pngBase64WithEyJ(1) },
            },
          ],
        },
      ],
    });

    const result = maskJsonBody(body, scan);
    expect(result.action).toBe("allow");
    expect(result.findings).toEqual([]);
    expect(result.maskedBody).toBe(body);
  });

  it("Gemini inline_data.data raw base64 with embedded eyJ+45 passes through byte-identical", () => {
    const body = JSON.stringify({
      contents: [
        {
          parts: [
            { text: "what is this?" },
            { inline_data: { mime_type: "image/png", data: pngBase64WithEyJ(2) } },
          ],
        },
      ],
    });

    const result = maskJsonBody(body, scan);
    expect(result.action).toBe("allow");
    expect(result.findings).toEqual([]);
    expect(result.maskedBody).toBe(body);
  });

  it("multi-image payload (media index[1] style) passes through byte-identical", () => {
    const body = JSON.stringify({
      model: "gpt-5.5",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/png;base64,${pngBase64WithEyJ(3)}` } },
            { type: "image_url", image_url: { url: `data:image/png;base64,${pngBase64WithEyJ(4)}` } },
          ],
        },
      ],
    });

    const result = maskJsonBody(body, scan);
    expect(result.action).toBe("allow");
    expect(result.maskedBody).toBe(body);
  });
});

describe("text secret scanning is not degraded (R3)", () => {
  it("sk- provider key in prompt text is still masked", () => {
    const body = JSON.stringify({
      messages: [{ role: "user", content: "api_key: sk-proj-abcdefghijklmnopqrstuvwxyz1234567890" }],
    });

    const result = maskJsonBody(body, scan);
    expect(result.action).toBe("mask");
    expect(result.maskedBody).toContain("<<PRIVACY_MASK:PROVIDER_API_KEY>>");
  });

  it("JWT in prompt text is still masked", () => {
    const body = JSON.stringify({
      messages: [{ role: "user", content: "token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U" }],
    });

    const result = maskJsonBody(body, scan);
    expect(result.action).toBe("mask");
    expect(result.maskedBody).toContain("<<PRIVACY_MASK:JWT>>");
  });

  it("bare eyJ+45 under a non-data key (text) is still masked as BASE64_TOKEN", () => {
    const body = JSON.stringify({
      messages: [{ role: "user", content: `token: ${"eyJ" + "A".repeat(45)}` }],
    });

    const result = maskJsonBody(body, scan);
    expect(result.action).toBe("mask");
    expect(result.maskedBody).toContain("<<PRIVACY_MASK:BASE64_TOKEN>>");
  });

  it("base64url JWT under a data key is still scanned (not pure base64)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const body = JSON.stringify({
      messages: [{ role: "user", content: [{ type: "base64", data: `token: ${jwt}` }] }],
    });

    const result = maskJsonBody(body, scan);
    expect(result.action).toBe("mask");
    expect(result.maskedBody).toContain("<<PRIVACY_MASK:JWT>>");
  });
});