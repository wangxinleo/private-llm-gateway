import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/config-loader", () => ({ initializeConfigs: vi.fn() }));
vi.mock("@/audit/retention", () => ({ initRetentionScheduler: vi.fn() }));
vi.mock("@/proxy/channels", () => ({ resolveChannel: vi.fn(() => null) }));
vi.mock("@/proxy/forwarder", () => ({ forwardRequest: vi.fn() }));
vi.mock("@/bypass/store", () => ({ findMatchingBypassRule: vi.fn(() => null) }));

import { POST } from "@/app/[...path]/route";
import { forwardRequest } from "@/proxy/forwarder";
import { subscribeAudit } from "@/audit/sse";
import { listSignalsByAuditIds } from "@/audit/signals-store";
import { createStreamingResponse } from "@/proxy/streaming";
import { describeUpstreamError, formatUpstreamError } from "@/proxy/error-trace";

const mockForward = vi.mocked(forwardRequest);
const PHONE = "13812345678";
const CHAT_BODY = JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: `我的手机 ${PHONE}` }] });
const CHAT_BYTES = new TextEncoder().encode(CHAT_BODY).length;

let events: string[] = [];
let unsubscribe: (() => void) | null = null;
let warnSpy: ReturnType<typeof vi.spyOn>;

function chatRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: CHAT_BODY,
  });
}

function auditIdFromEvents(): number {
  const auditEvent = events.find((e) => e.startsWith("event: audit\ndata:"))!;
  return (JSON.parse(auditEvent.slice(auditEvent.indexOf("data: ") + 6).trim()) as { id: number }).id;
}

function upstreamErrorSignal(auditId: number): { signal: string; severity: string; detail: Record<string, unknown> } | undefined {
  const row = listSignalsByAuditIds([auditId]).find((s) => s.signal === "upstream_error");
  if (!row) return undefined;
  return { signal: row.signal, severity: row.severity, detail: JSON.parse(row.detail) as Record<string, unknown> };
}

function socketError(): Error {
  return Object.assign(new Error("terminated"), { name: "SocketError", code: "UND_ERR_SOCKET" });
}

function warnLines(): string[] {
  return warnSpy.mock.calls.map((call) => call.map((a) => String(a)).join(" "));
}

function tagOf(body: unknown): string {
  return (typeof body === "string" ? body : "").match(/\{\{PHONE_[bcdfghjkmnpqrstvwxz]{5}\}\}/)?.[0] ?? "{{PHONE_missing}}";
}

async function readAllUntilError(res: Response): Promise<{ text: string; caught: unknown }> {
  let text = "";
  let caught: unknown;
  try {
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
  } catch (err) {
    caught = err;
  }
  return { text, caught };
}

describe("error-trace 诊断字段", () => {
  it("cause 名与错误码优先于 undici 外层 TypeError", () => {
    const trace = describeUpstreamError(
      new TypeError("fetch failed", { cause: socketError() }),
      { resp: 1, out: 42, ms: 12.34 }
    );
    expect(trace).toEqual({ err: "SocketError", code: "UND_ERR_SOCKET", resp: 1, out: 42, ms: 12.3 });
  });

  it("无 cause 取外层名;非 Error 取 typeof", () => {
    expect(describeUpstreamError(new RangeError("boom"), { resp: 0, req: 7, ms: 1 })).toEqual({
      err: "RangeError",
      resp: 0,
      req: 7,
      ms: 1,
    });
    expect(describeUpstreamError("boom", { resp: 0, ms: 1 }).err).toBe("string");
  });

  it("formatUpstreamError 固定字段顺序,可选字段缺省省略", () => {
    expect(
      formatUpstreamError({ err: "SocketError", code: "UND_ERR_SOCKET", resp: 1, req: 10, out: 4, ms: 2.5 })
    ).toBe("[err=SocketError code=UND_ERR_SOCKET resp=1 req=10B out=4B ms=2.5]");
    expect(formatUpstreamError({ err: "Error", resp: 0, req: 3, ms: 1 })).toBe("[err=Error resp=0 req=3B ms=1]");
  });
});

describe("upstream error trace: 非流式", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events = [];
    unsubscribe = subscribeAudit((msg) => events.push(msg));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    warnSpy.mockRestore();
  });

  it("回包前失败:502 + upstream_error 信号(resp=0/req 字节/耗时) + warn 诊断前缀", async () => {
    mockForward.mockRejectedValue(new TypeError("fetch failed", { cause: socketError() }));

    const res = await POST(chatRequest());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream_error" });

    const auditId = auditIdFromEvents();
    const sig = upstreamErrorSignal(auditId);
    expect(sig).toBeTruthy();
    expect(sig!.severity).toBe("HIGH");
    expect(sig!.detail).toMatchObject({
      err: "SocketError",
      code: "UND_ERR_SOCKET",
      resp: 0,
      req: CHAT_BYTES,
    });
    expect(typeof sig!.detail.ms).toBe("number");

    const line = warnLines().find((l) => l.includes("upstream error"));
    expect(line).toBeTruthy();
    expect(line).toContain("err=SocketError");
    expect(line).toContain("code=UND_ERR_SOCKET");
    expect(line).toContain("resp=0");
    expect(line).toContain(`req=${CHAT_BYTES}B`);
    expect(line).toMatch(/ms=\d/);
  });

  it("回包中途断开(缓冲路径读体失败):resp=1 且仍返回 502", async () => {
    const erroringBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(socketError());
      },
    });
    mockForward.mockResolvedValue(
      new Response(erroringBody, { status: 200, headers: { "content-type": "application/json" } })
    );

    const res = await POST(chatRequest());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream_error" });

    const sig = upstreamErrorSignal(auditIdFromEvents());
    expect(sig).toBeTruthy();
    expect(sig!.detail).toMatchObject({ err: "SocketError", code: "UND_ERR_SOCKET", resp: 1, req: CHAT_BYTES });

    const line = warnLines().find((l) => l.includes("upstream error"));
    expect(line).toContain("resp=1");
  });
});

describe("upstream error trace: 流式中断", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events = [];
    unsubscribe = subscribeAudit((msg) => events.push(msg));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    warnSpy.mockRestore();
  });

  it("SSE 帧中途断连:已下发部分可读 + upstream_error 信号(resp=1/out 字节) + warn 日志", async () => {
    mockForward.mockImplementation(async (_path, _request, body) => {
      const tag = tagOf(body);
      const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: `echo ${tag}` } }] })}\n\n`;
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(new TextEncoder().encode(frame));
            return;
          }
          controller.error(socketError());
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    });

    const res = await POST(chatRequest());
    expect(res.status).toBe(200);
    const { text, caught } = await readAllUntilError(res);

    expect(caught).toBeTruthy();
    expect(text).toContain(PHONE);

    const sig = upstreamErrorSignal(auditIdFromEvents());
    expect(sig).toBeTruthy();
    expect(sig!.severity).toBe("HIGH");
    expect(sig!.detail).toMatchObject({ err: "SocketError", code: "UND_ERR_SOCKET", resp: 1 });
    expect(sig!.detail.out).toBe(new TextEncoder().encode(text).length);
    expect(typeof sig!.detail.ms).toBe("number");

    const line = warnLines().find((l) => l.includes("stream aborted"));
    expect(line).toBeTruthy();
    expect(line).toContain("err=SocketError");
    expect(line).toContain("resp=1");
    expect(line).toMatch(/out=\d+B/);
  });

  it("无 analyzer 时中断不崩:截断语义不变(读取仍抛出)", async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new TextEncoder().encode("data: first\n\n"));
          return;
        }
        controller.error(socketError());
      },
    });
    const upstream = new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });

    const { text, caught } = await readAllUntilError(createStreamingResponse(upstream));
    expect(caught).toBeTruthy();
    expect(text).toBe("data: first\n\n");
  });
});
