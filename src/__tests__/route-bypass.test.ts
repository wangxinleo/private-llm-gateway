import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/[[...path]]/route";

vi.mock("@/proxy/forwarder", () => ({
  forwardRequest: vi.fn(),
}));

vi.mock("@/audit/logger", () => ({
  logAudit: vi.fn(),
}));

vi.mock("@/bypass/store", () => ({
  findMatchingBypassRule: vi.fn(),
}));

import { forwardRequest } from "@/proxy/forwarder";
import { logAudit } from "@/audit/logger";
import { findMatchingBypassRule } from "@/bypass/store";

const mockForward = vi.mocked(forwardRequest);
const mockLogAudit = vi.mocked(logAudit);
const mockFindMatchingBypassRule = vi.mocked(findMatchingBypassRule);

function makeRequest(path: string, body: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("route bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockForward.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, upstream: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  });

  it("records findings while forwarding original body when active bypass rule matches", async () => {
    mockFindMatchingBypassRule.mockReturnValue({
      id: 7,
      enabled: 1,
      pathPrefix: "/v1/chat",
      modelName: "gpt-4o-mini",
      startAt: "2026-06-22T02:00:00.000Z",
      endAt: "2026-06-22T10:00:00.000Z",
      note: "incident window",
      createdAt: "2026-06-22T01:00:00.000Z",
      updatedAt: "2026-06-22T01:00:00.000Z",
    });

    const body = JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Bearer abc123token" }],
    });

    const response = await POST(makeRequest("/v1/chat/completions", body));
    expect(response.status).toBe(200);

    expect(mockFindMatchingBypassRule).toHaveBeenCalledWith({
      path: "/v1/chat/completions",
      model: "gpt-4o-mini",
      now: expect.any(Date),
    });

    expect(mockForward).toHaveBeenCalledWith(
      "/v1/chat/completions",
      expect.any(NextRequest),
      body
    );

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/v1/chat/completions",
        action: "allow",
        bypassApplied: true,
        findings: expect.arrayContaining([
          expect.objectContaining({ category: "BEARER_TOKEN" }),
        ]),
      })
    );
  });

  it("continues original filtering when no active bypass rule matches", async () => {
    mockFindMatchingBypassRule.mockReturnValue(null);

    const body = JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Bearer abc123token" }],
    });

    const response = await POST(makeRequest("/v1/chat/completions", body));
    expect(response.status).toBe(200);

    expect(mockForward).toHaveBeenCalled();
    const forwardedBody = mockForward.mock.calls[0]?.[2];
    expect(typeof forwardedBody).toBe("string");
    expect(forwardedBody).toContain("<<PRIVACY_MASK:BEARER_TOKEN>>");
  });
});
