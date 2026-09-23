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
import { logAudit } from "@/audit/logger";
import { RUNTIME } from "@/config";
import { listSignalsByAuditIds } from "@/audit/signals-store";

const mockForward = vi.mocked(forwardRequest);
const mockLogAudit = vi.mocked(logAudit);
const PHONE = "13812345678";
const LIMIT = 1024;

function chatRequest() {
  return new NextRequest("http://localhost:3000/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: `我的手机 ${PHONE}` }] }),
  });
}

function tagFromForwardedBody(body: unknown): string {
  return (typeof body === "string" ? body : "").match(/\{\{PHONE_[bcdfghjkmnpqrstvwxz]+\}\}/)?.[0] ?? "{{PHONE_missing}}";
}

function signalsOf(auditId: number) {
  return listSignalsByAuditIds([auditId]);
}

async function readAtMost(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel();
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

describe("route: 响应体还原体积闸 + 跳过留痕", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    RUNTIME.maxBodyBytes = LIMIT;
  });

  it("超限且永不结束的非流式响应:立即返回,已发字节原样可读(不再整流挂起)", async () => {
    mockLogAudit.mockReturnValue(101);
    const sent = new TextEncoder().encode("x".repeat(4096));
    mockForward.mockImplementation(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(sent);
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    });

    const outcome = await Promise.race([
      POST(chatRequest()),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 500)),
    ]);

    expect(outcome).not.toBe("hung");
    const res = outcome as Response;
    expect(new Uint8Array(await readAtMost(res.body!, 4096))).toEqual(sent);
    const signals = signalsOf(101);
    expect(signals.map((s) => s.signal)).toEqual(["restore_skipped"]);
  });

  it("超限有限响应:不还原、字节逐字节一致,restore_skipped 留痕(只含数字)", async () => {
    mockLogAudit.mockReturnValue(102);
    let payload = "";
    mockForward.mockImplementation(async (_path, _request, body) => {
      payload = JSON.stringify({ pad: "x".repeat(4096), echo: `已记录 ${tagFromForwardedBody(body)}` });
      return new Response(payload, { status: 200, headers: { "content-type": "application/json" } });
    });

    const res = await POST(chatRequest());
    const text = await res.text();

    // 跳过还原:占位符原样;字节与上游完全一致
    expect(text).toBe(payload);
    expect(text).toContain("{{PHONE_");
    expect(text).not.toContain(PHONE);

    const [signal] = signalsOf(102);
    expect(signal.signal).toBe("restore_skipped");
    expect(signal.severity).toBe("MEDIUM");
    const detail = JSON.parse(signal.detail) as Record<string, unknown>;
    expect(detail).toEqual({ reason: "response_too_large", bytes: new TextEncoder().encode(payload).length, limit: LIMIT });
    expect(JSON.stringify(detail)).not.toContain("{{");
    expect(JSON.stringify(detail)).not.toContain(PHONE);
  });

  it("content-length 声明超限(none 编码):不读 body 直接透传 + 留痕", async () => {
    mockLogAudit.mockReturnValue(103);
    const body = JSON.stringify({ echo: `已记录 ${"{{PHONE_xxxxxxxxx}}"}` });
    mockForward.mockImplementation(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "999999" },
      });
    });

    const res = await POST(chatRequest());

    expect(await res.text()).toBe(body);
    const [signal] = signalsOf(103);
    expect(signal.signal).toBe("restore_skipped");
    expect(JSON.parse(signal.detail)).toEqual({ reason: "response_too_large", bytes: 999999, limit: LIMIT });
  });

  it("decoded 编码(gzip)不做声明值快速跳过:声明超限、实测未超限仍还原", async () => {
    mockLogAudit.mockReturnValue(104);
    mockForward.mockImplementation(async (_path, _request, body) => {
      const payload = JSON.stringify({ echo: `已记录 ${tagFromForwardedBody(body)}` });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "999999" },
      });
    });

    const res = await POST(chatRequest());
    const text = await res.text();

    expect(text).toContain(PHONE);
    expect(text).not.toContain("{{PHONE_");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(signalsOf(104)).toHaveLength(0);
  });

  it("未超限对照:照旧整读还原,无跳过信号", async () => {
    mockLogAudit.mockReturnValue(105);
    mockForward.mockImplementation(async (_path, _request, body) => {
      const payload = JSON.stringify({ echo: `已记录 ${tagFromForwardedBody(body)}` });
      return new Response(payload, { status: 200, headers: { "content-type": "application/json" } });
    });

    const res = await POST(chatRequest());
    const text = await res.text();

    expect(text).toContain(PHONE);
    expect(text).not.toContain("{{PHONE_");
    expect(signalsOf(105)).toHaveLength(0);
  });
});
