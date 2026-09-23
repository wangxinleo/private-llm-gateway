import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/config-loader", () => ({ initializeConfigs: vi.fn() }));
vi.mock("@/audit/retention", () => ({ initRetentionScheduler: vi.fn() }));
vi.mock("@/proxy/channels", () => ({ resolveChannel: vi.fn(() => null) }));
vi.mock("@/proxy/forwarder", () => ({ forwardRequest: vi.fn() }));
vi.mock("@/audit/logger", () => ({ logAudit: vi.fn(() => 1), recordRestoreStats: vi.fn() }));
vi.mock("@/bypass/store", () => ({ findMatchingBypassRule: vi.fn(() => null) }));

import { POST } from "@/app/[...path]/route";
import { forwardRequest } from "@/proxy/forwarder";

const mockForward = vi.mocked(forwardRequest);
const PHONE = "13812345678";

function chatRequest() {
  return new NextRequest("http://localhost:3000/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: `我的手机 ${PHONE}` }] }),
  });
}

async function firstRestoredFrame(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoded = new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  return decoded;
}

// 永不 close 的上游流:走缓冲路径(await upstream.text())会永远挂起 —— 探针即以此判别
function openSseResponse(contentType: string, maskedBody: string) {
  const tag = maskedBody.match(/\{\{PHONE_[bcdfghjkmnpqrstvwxz]+\}\}/)?.[0] ?? "{{PHONE_missing}}";
  const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: `已记录 ${tag}` } }] })}\n\n`;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frame));
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": contentType } });
}

describe("route: 响应 content-type 判定归一化", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("大写的 Text/Event-Stream 仍走流式:立即返回且首帧增量可读(占位符已还原)", async () => {
    mockForward.mockImplementation(async (_path, _request, body) => {
      return openSseResponse("Text/Event-Stream", typeof body === "string" ? body : "");
    });

    const outcome = await Promise.race([
      POST(chatRequest()).then((res) => res),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 500)),
    ]);

    expect(outcome).not.toBe("hung");
    const first = await firstRestoredFrame(outcome as Response);
    expect(first).toContain(PHONE);
    expect(first).not.toContain("{{");
  });

  it("带空白与参数的 SSE content-type 同样走流式", async () => {
    mockForward.mockImplementation(async (_path, _request, body) => {
      return openSseResponse(" Text/Event-Stream ; charset=utf-8", typeof body === "string" ? body : "");
    });

    const outcome = await Promise.race([
      POST(chatRequest()).then((res) => res),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 500)),
    ]);

    expect(outcome).not.toBe("hung");
    expect(await firstRestoredFrame(outcome as Response)).toContain(PHONE);
  });

  it("大写的 Application/Octet-Stream 二进制响应体字节原样(不被 UTF-8 解码破坏)", async () => {
    const original = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x01]);
    mockForward.mockResolvedValue(new Response(original, { status: 200, headers: { "content-type": "Application/Octet-Stream" } }));

    const res = await POST(chatRequest());

    expect(new Uint8Array(await res.arrayBuffer())).toEqual(original);
  });

  it("小写对照:常规 SSE 与二进制判定保持既有行为", async () => {
    mockForward.mockImplementation(async (_path, _request, body) => {
      return openSseResponse("text/event-stream; charset=utf-8", typeof body === "string" ? body : "");
    });

    const outcome = await Promise.race([
      POST(chatRequest()).then((res) => res),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 500)),
    ]);

    expect(outcome).not.toBe("hung");
    expect(await firstRestoredFrame(outcome as Response)).toContain(PHONE);

    mockForward.mockResolvedValue(
      new Response(new Uint8Array([0x00, 0xff]), { status: 200, headers: { "content-type": "application/octet-stream" } })
    );
    const res = await POST(chatRequest());
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x00, 0xff]));
  });
});
