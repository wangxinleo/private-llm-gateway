import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStreamingResponse } from "@/proxy/streaming";
import { StreamResponseAnalyzer } from "@/proxy/response-analysis";
import { SseChannelRestorer } from "@/proxy/restore";
import { MaskRegistry } from "@/scanner/mask-registry";
import { listSignalsByAuditIds } from "@/audit/signals-store";

// 客户端主动取消 ≠ 上游故障(2026-09-23 E2E 发现):客户端断开后 pull 循环的
// controller.close/enqueue 抛 ERR_INVALID_STATE,曾被 catch 记为 HIGH upstream_error。
const PHONE = "13812345678";

function socketError(): Error {
  return Object.assign(new Error("terminated"), { name: "SocketError", code: "UND_ERR_SOCKET" });
}

function makeSetup(auditId: number) {
  const registry = new MaskRegistry();
  const tag = registry.tagFor("PHONE", PHONE);
  const restorer = new SseChannelRestorer(registry);
  const analyzer = new StreamResponseAnalyzer(
    { status: 200, forwardValues: [...registry.tagToValue.values()] },
    auditId,
    restorer
  );
  const frame = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: `echo ${tag}` } }] })}\n\n`);
  return { registry, restorer, analyzer, frame };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("streaming: 客户端取消与上游中断分类", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("客户端 reader.cancel:不写 upstream_error 信号,无 stream aborted warn", async () => {
    const auditId = 90101;
    const { restorer, analyzer, frame } = makeSetup(auditId);
    let upstreamCancelled = false;
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(frame);
        },
        pull() {
          return new Promise(() => {});
        },
        cancel() {
          upstreamCancelled = true;
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );

    const res = createStreamingResponse(upstream, restorer, analyzer);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(PHONE);

    await settle(); // 让 pull 循环挂在等待上游的 reader.read() 上
    await reader.cancel();
    await settle();

    expect(upstreamCancelled).toBe(true);
    expect(listSignalsByAuditIds([auditId])).toHaveLength(0);
    const abortedWarn = warnSpy.mock.calls.map((c) => c.map(String).join(" ")).find((l) => l.includes("stream aborted"));
    expect(abortedWarn).toBeUndefined();
  });

  it("对照:上游中途断开仍记 upstream_error(裁面不误伤真实故障)", async () => {
    const auditId = 90102;
    const { restorer, analyzer, frame } = makeSetup(auditId);
    let pulls = 0;
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(frame);
            return;
          }
          controller.error(socketError());
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );

    const res = createStreamingResponse(upstream, restorer, analyzer);
    const reader = res.body!.getReader();
    let caught: unknown;
    try {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch (err) {
      caught = err;
    }
    await settle();

    expect(caught).toBeTruthy();
    const signals = listSignalsByAuditIds([auditId]);
    expect(signals.map((s) => s.signal)).toEqual(["upstream_error"]);
    expect(signals[0]!.severity).toBe("HIGH");
    const detail = JSON.parse(signals[0]!.detail) as Record<string, unknown>;
    expect(detail).toMatchObject({ err: "SocketError", code: "UND_ERR_SOCKET", resp: 1 });
    const abortedWarn = warnSpy.mock.calls.map((c) => c.map(String).join(" ")).find((l) => l.includes("stream aborted"));
    expect(abortedWarn).toBeTruthy();
  });
});
