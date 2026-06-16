import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/[[...path]]/route";
import { NextRequest } from "next/server";

vi.mock("@/proxy/forwarder", () => ({
  forwardRequest: vi.fn(),
}));

vi.mock("@/audit/logger", () => ({
  logAudit: vi.fn(),
}));

import { forwardRequest } from "@/proxy/forwarder";

const mockForward = vi.mocked(forwardRequest);

function makeRequest(
  path: string,
  body?: string,
  method = "POST",
  contentType = "application/json",
): NextRequest {
  const url = `http://localhost:3000/api${path}`;
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers: { "content-type": contentType } };
  if (body !== undefined) init.body = body;
  return new NextRequest(url, init);
}

describe("upstream error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 502 with generic error when upstream fails", async () => {
    const dnsError = new TypeError("fetch failed", {
      cause: new Error("getaddrinfo ENOTFOUND internal-upstream.corp.local"),
    });
    mockForward.mockRejectedValue(dnsError);

    const req = makeRequest("/v1/chat/completions", '{"message":"hello"}');
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json).toEqual({ error: "upstream_error" });
  });

  it("does not expose internal hostnames in 502 response", async () => {
    const connError = new TypeError("fetch failed", {
      cause: new Error("connect ECONNREFUSED 10.0.1.50:8787"),
    });
    mockForward.mockRejectedValue(connError);

    const req = makeRequest("/v1/chat/completions", '{"message":"test"}');
    const res = await POST(req);
    const text = JSON.stringify(await res.json());

    expect(text).not.toContain("10.0.1.50");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("internal-upstream");
  });

  it("does not expose upstream URL details for non-Error throws", async () => {
    mockForward.mockRejectedValue("string error with http://secret-host:8787");

    const req = makeRequest("/v1/chat/completions", '{"message":"test"}');
    const res = await POST(req);
    const text = JSON.stringify(await res.json());

    expect(res.status).toBe(502);
    expect(text).not.toContain("secret-host");
    expect(text).not.toContain("8787");
  });
});
