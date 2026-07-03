import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/admin/audit/stream/route";
import { broadcastAudit } from "@/audit/sse";

const decoder = new TextDecoder();

function makeRequest(adminKey?: string): Request {
  const url = "http://localhost:3000/api/admin/audit/stream";
  if (!adminKey) return new Request(url);
  return new Request(url, { headers: { "x-admin-key": adminKey } });
}

describe("admin audit stream", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ADMIN_KEY;
    process.env.ADMIN_KEY = "test-key";
  });

  afterEach(() => {
    process.env.ADMIN_KEY = originalKey;
  });

  it("accepts admin key from x-admin-key header", async () => {
    const res = await GET(makeRequest("test-key"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const reader = res.body?.getReader();
    if (!reader) throw new Error("expected stream body");
    const first = await reader.read();
    await reader.cancel();

    expect(first.done).toBe(false);
    expect(decoder.decode(first.value)).toContain("event: connected");
  });

  it("rejects stream requests without an admin key", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects admin keys from query parameters", async () => {
    const res = await GET(new Request("http://localhost:3000/api/admin/audit/stream?key=test-key"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("forwards audit broadcasts to active stream subscribers", async () => {
    const res = await GET(makeRequest("test-key"));
    const reader = res.body?.getReader();
    if (!reader) throw new Error("expected stream body");

    await reader.read();
    const next = reader.read();
    broadcastAudit({ id: 7, path: "/v1/chat", action: "allow" });
    const event = await next;
    await reader.cancel();

    expect(event.done).toBe(false);
    const text = decoder.decode(event.value);
    expect(text).toContain("event: audit");
    expect(text).toContain('"id":7');
    expect(text).toContain('"path":"/v1/chat"');
  });
});
