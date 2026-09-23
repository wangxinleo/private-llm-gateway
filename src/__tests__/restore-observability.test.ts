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
import { getDb } from "@/audit/store";
import { listSignalsByAuditIds } from "@/audit/signals-store";
import { RUNTIME } from "@/config";

const mockForward = vi.mocked(forwardRequest);
const PHONE = "13812345678";
const UNISSUED = "PHONE_zzzzq";

interface UpdatePayload {
  id: number;
  restoreCount: number;
  restoreDegraded: number;
  restoreUnresolved: number;
  restoreSamples: string[];
}

let events: string[] = [];
let unsubscribe: (() => void) | null = null;

function auditUpdates(): UpdatePayload[] {
  return events
    .filter((e) => e.startsWith("event: audit_update"))
    .map((e) => JSON.parse(e.slice(e.indexOf("data: ") + 6).trim()) as UpdatePayload);
}

function restoreColumns(id: number) {
  return getDb()
    .prepare("SELECT restore_count, restore_degraded, restore_unresolved, restore_samples FROM audit_log WHERE id = ?")
    .get(id) as {
    restore_count: number | null;
    restore_degraded: number | null;
    restore_unresolved: number | null;
    restore_samples: string | null;
  };
}

function chatRequest() {
  return new NextRequest("http://localhost:3000/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: `我的手机 ${PHONE}` }] }),
  });
}

function plainRequest() {
  return new NextRequest("http://localhost:3000/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hello world" }] }),
  });
}

function tagOf(body: unknown): string {
  return (typeof body === "string" ? body : "").match(/\{\{PHONE_[bcdfghjkmnpqrstvwxz]{5}\}\}/)?.[0] ?? "{{PHONE_missing}}";
}

describe("route: 响应还原可观测性", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events = [];
    unsubscribe = subscribeAudit((msg) => events.push(msg));
    RUNTIME.maxBodyBytes = 32 * 1024 * 1024;
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  it("非流式:严格+降级形态计数、未发行 token 计入未还原并落库", async () => {
    mockForward.mockImplementation(async (_path, _request, body) => {
      const tag = tagOf(body);
      const core = tag.slice(2, -2);
      const payload = JSON.stringify({
        echo: `${tag} + {{ ${core} }} + ${core} + ${UNISSUED}`,
      });
      return new Response(payload, { status: 200, headers: { "content-type": "application/json" } });
    });

    const res = await POST(chatRequest());
    const text = await res.text();

    // 还原语义:三种形态恢复为原文,未发行 token 原样保留
    expect(text).toContain(`${PHONE} + ${PHONE} + ${PHONE} + ${UNISSUED}`);
    expect(text).not.toContain("{{ PHONE_");

    const [update] = auditUpdates();
    expect(update).toBeTruthy();
    expect(update.restoreCount).toBe(3);
    expect(update.restoreDegraded).toBe(2);
    expect(update.restoreUnresolved).toBe(1);
    expect(update.restoreSamples).toEqual([UNISSUED]);

    const row = restoreColumns(update.id);
    expect(row.restore_count).toBe(3);
    expect(row.restore_degraded).toBe(2);
    expect(row.restore_unresolved).toBe(1);
    expect(JSON.parse(row.restore_samples!) as string[]).toEqual([UNISSUED]);

    // 信号侧与列侧同源:placeholder_residual 计数应与 restore_unresolved 一致
    const residual = listSignalsByAuditIds([update.id]).filter((s) => s.signal === "response_poison");
    const detail = JSON.parse(residual[0]!.detail) as { kind: string; count: number };
    expect(detail.kind).toBe("placeholder_residual");
    expect(detail.count).toBe(1);
  });

  it("SSE:restorer 统计与累积文本未还原计数在流尾落库", async () => {
    mockForward.mockImplementation(async (_path, _request, body) => {
      const tag = tagOf(body);
      const frames = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: `start ${tag}` } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: ` mid ${UNISSUED} end` } }] })}\n\n`,
        "data: [DONE]\n\n",
      ];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    });

    const res = await POST(chatRequest());
    const text = await res.text();

    expect(text).toContain(`start ${PHONE}`);
    expect(text).toContain(`mid ${UNISSUED} end`);
    expect(text).not.toContain("{{PHONE_");

    const [update] = auditUpdates();
    expect(update).toBeTruthy();
    expect(update.restoreCount).toBe(1);
    expect(update.restoreDegraded).toBe(0);
    expect(update.restoreUnresolved).toBe(1);
    expect(update.restoreSamples).toEqual([UNISSUED]);

    const row = restoreColumns(update.id);
    expect(row.restore_count).toBe(1);
    expect(row.restore_degraded).toBe(0);
    expect(row.restore_unresolved).toBe(1);
    expect(JSON.parse(row.restore_samples!) as string[]).toEqual([UNISSUED]);
  });

  it("未发生还原遍(空 registry):四列保持 NULL,无 audit_update 广播", async () => {
    mockForward.mockImplementation(async () => {
      return new Response(JSON.stringify({ echo: "plain answer" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const res = await POST(plainRequest());
    expect(await res.text()).toContain("plain answer");

    expect(auditUpdates()).toHaveLength(0);
    const auditEvent = events.find((e) => e.startsWith("event: audit\ndata:"))!;
    const auditId = (JSON.parse(auditEvent.slice(auditEvent.indexOf("data: ") + 6).trim()) as { id: number }).id;
    expect(restoreColumns(auditId)).toEqual({
      restore_count: null,
      restore_degraded: null,
      restore_unresolved: null,
      restore_samples: null,
    });
  });

  it("超限跳过路径:四列保持 NULL,只留 restore_skipped 信号", async () => {
    RUNTIME.maxBodyBytes = 1024;
    mockForward.mockImplementation(async (_path, _request, body) => {
      const payload = JSON.stringify({ pad: "x".repeat(2048), echo: `${tagOf(body)} ${UNISSUED}` });
      return new Response(payload, { status: 200, headers: { "content-type": "application/json" } });
    });

    const res = await POST(chatRequest());
    void (await res.text());

    expect(auditUpdates()).toHaveLength(0);
    const auditEvent = events.find((e) => e.startsWith("event: audit\ndata:"))!;
    const auditId = (JSON.parse(auditEvent.slice(auditEvent.indexOf("data: ") + 6).trim()) as { id: number }).id;
    expect(restoreColumns(auditId)).toEqual({
      restore_count: null,
      restore_degraded: null,
      restore_unresolved: null,
      restore_samples: null,
    });
    expect(listSignalsByAuditIds([auditId]).map((s) => s.signal)).toEqual(["restore_skipped"]);
  });
});
