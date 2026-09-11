import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/[[...path]]/route";
import { MaskRegistry } from "@/scanner/mask-registry";
import { runPipeline } from "@/scanner/pipeline";
import { SseChannelRestorer } from "@/proxy/restore";

vi.mock("@/config-loader", () => ({ initializeConfigs: vi.fn() }));
vi.mock("@/proxy/forwarder", () => ({ forwardRequest: vi.fn() }));
vi.mock("@/audit/logger", () => ({ logAudit: vi.fn() }));
vi.mock("@/bypass/store", () => ({ findMatchingBypassRule: vi.fn() }));

import { forwardRequest } from "@/proxy/forwarder";
import { findMatchingBypassRule } from "@/bypass/store";
import { PRIVACY_NOTICE_TEXT } from "@/config";

const mockForward = vi.mocked(forwardRequest);
const mockFindMatchingBypassRule = vi.mocked(findMatchingBypassRule);

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CODES = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];

function genIdCard(seed: number): string {
  const base = `110101199001${String(100000 + seed).slice(1)}`;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(base[i]) * ID_WEIGHTS[i]!;
  return base + ID_CODES[sum % 11];
}

function genBankCard(seed: number): string {
  const body = `622200${String(100000000 + seed * 7919)}`;
  const digits = body.split("").map(Number);
  let sum = 0;
  for (let i = digits.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
    let x = digits[i]!;
    if (dbl) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
  }
  return body + String((10 - (sum % 10)) % 10);
}

interface GeneratedValue {
  kind: string;
  value: string;
}

export function generateCorpus(): GeneratedValue[] {
  const vals: GeneratedValue[] = [];
  for (let i = 0; i < 45; i++) vals.push({ kind: "phone", value: `138${String(12340000 + i)}` });
  for (let i = 0; i < 35; i++) vals.push({ kind: "email", value: `user${i}@example.com` });
  for (let i = 0; i < 20; i++) vals.push({ kind: "idcard", value: genIdCard(i) });
  for (let i = 0; i < 10; i++) vals.push({ kind: "bank", value: genBankCard(i) });
  for (let i = 0; i < 10; i++)
    vals.push({ kind: "bearer", value: `Authorization: Bearer T${i}z9wV8uT7sR6qP5oN4mL${i}kJ2aB` });
  for (let i = 0; i < 10; i++)
    vals.push({ kind: "sk", value: `sk-proj-${i}b3Cd4Ef5Gh6Ij7Kl8Mn9Op${i}Qr8St9` });
  return vals;
}

const TAG_GLOBAL = /\{\{[A-Z][A-Z0-9_]*_[bcdfghjkmnpqrstvwxz]{5}\}\}/g;

function buildContent(values: GeneratedValue[]): string {
  return values
    .map((v, i) => (v.kind === "email" ? `email: ${v.value}` : `${v.kind}${i}: ${v.value}`))
    .join("\n");
}

function makeRequest(body: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function assembleSse(raw: string): string {
  let out = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") continue;
    out += (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content ?? "";
  }
  return out;
}

describe("stress: 130 mixed sensitive values in one request/SSE stream", () => {
  const corpus = generateCorpus();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMatchingBypassRule.mockReturnValue(null);
  });

  it("masks every value upstream (zero leak) and restores all of them from a heavily split SSE echo", async () => {
    expect(corpus.length).toBeGreaterThanOrEqual(130);
    const content = buildContent(corpus);
    const request = { model: "gpt-4o-mini", messages: [{ role: "user", content }] };

    let upstreamBody = "";
    mockForward.mockImplementationOnce(async (_p, _req, body) => {
      upstreamBody = String(body);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const echo = JSON.stringify({ echo: upstreamBody });
          for (let i = 0; i < echo.length; i += 7) {
            const frame = { choices: [{ delta: { content: echo.slice(i, i + 7) } }] };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const res = await POST(makeRequest(JSON.stringify(request)));
    expect(res.ok).toBe(true);
    expect(upstreamBody.length).toBeGreaterThan(0);

    // 上行零泄漏:130 个原始值在上游载荷中出现 0 次
    for (const { kind, value } of corpus) {
      expect(upstreamBody, `${kind} leaked upstream`).not.toContain(value);
    }
    const upstreamTags = new Set(upstreamBody.match(TAG_GLOBAL) ?? []);
    expect(upstreamTags.size).toBeGreaterThanOrEqual(130);

    // 下行还原:SSE 回显被 7 字符任意切分(占位符大量跨事件),客户端应拿回全部原始值、零占位符
    const assembled = assembleSse(await res.text());
    for (const { kind, value } of corpus) {
      expect(assembled, `${kind} not restored: ${value}`).toContain(value);
    }
    const noticeExampleTag = PRIVACY_NOTICE_TEXT.match(TAG_GLOBAL)?.[0];
    const leftoverTags = (assembled.match(TAG_GLOBAL) ?? []).filter((t) => t !== noticeExampleTag);
    expect(leftoverTags).toEqual([]);
  });

  it("restores a 130-tag payload fed to SseChannelRestorer one byte at a time", () => {
    const content = buildContent(corpus);
    const registry = new MaskRegistry();
    const scan = runPipeline(content, content.length, [], registry);
    expect(scan.registry?.size).toBeGreaterThanOrEqual(130);
    const masked = scan.maskedBody;
    expect(masked.match(TAG_GLOBAL)?.length ?? 0).toBeGreaterThanOrEqual(130);

    const restorer = new SseChannelRestorer(registry!);
    const frames = [`data: {"choices":[{"delta":{"content":${JSON.stringify(masked)}}}]}\n\n`, "data: [DONE]\n\n"];
    let out = "";
    for (const frame of frames) {
      for (const ch of frame) {
        out += restorer.pushBytes(ch);
      }
    }
    out += restorer.flush();

    for (const { kind, value } of corpus) {
      expect(out, `${kind} not restored byte-by-byte: ${value}`).toContain(value);
    }
    expect(out).not.toMatch(TAG_GLOBAL);
    expect(out).toContain("data: [DONE]");
  });
});
