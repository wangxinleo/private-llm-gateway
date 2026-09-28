import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/config-loader", () => ({
  initializeConfigs: vi.fn(),
}));

vi.mock("@/audit/retention", () => ({
  initRetentionScheduler: vi.fn(),
}));

vi.mock("@/proxy/channels", () => ({
  resolveChannel: vi.fn(() => null),
}));

vi.mock("@/proxy/forwarder", () => ({
  forwardRequest: vi.fn(),
}));

vi.mock("@/audit/logger", () => ({
  logAudit: vi.fn(),
  recordRestoreStats: vi.fn(),
}));

vi.mock("@/bypass/store", () => ({
  findMatchingBypassRule: vi.fn(),
}));

import { GET, POST } from "@/app/[...path]/route";
import { initializeConfigs } from "@/config-loader";
import { forwardRequest } from "@/proxy/forwarder";
import { findMatchingBypassRule } from "@/bypass/store";

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

const mockInitializeConfigs = vi.mocked(initializeConfigs);
const mockForward = vi.mocked(forwardRequest);
const mockFindMatchingBypassRule = vi.mocked(findMatchingBypassRule);

function makeRequest(path: string, init?: NextRequestInit): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

describe("proxy route LLM compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMatchingBypassRule.mockReturnValue(null);
    mockForward.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  });

  it("preserves query strings when forwarding upstream", async () => {
    const response = await GET(makeRequest("/v1/models?provider=openai&debug=true"));

    expect(response.status).toBe(200);
    expect(mockForward).toHaveBeenCalledWith(
      "/v1/models?provider=openai&debug=true",
      expect.any(NextRequest),
      undefined
    );
  });

  it("initializes runtime config before proxy scan and bypass decisions", async () => {
    await POST(makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [] }),
    }));

    expect(mockInitializeConfigs).toHaveBeenCalledTimes(1);
    expect(mockFindMatchingBypassRule).toHaveBeenCalled();
    expect(mockInitializeConfigs.mock.invocationCallOrder[0]).toBeLessThan(
      mockFindMatchingBypassRule.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
  });

  it("masks contextual JSON secrets and forwards instead of blocking", async () => {
    const rawSecret = "abc12345_67890";

    const response = await POST(makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        api_key: rawSecret,
        messages: [{ role: "user", content: "hello" }],
      }),
    }));

    expect(response.status).toBe(200);
    const forwardedBody = mockForward.mock.calls[0]?.[2];
    expect(typeof forwardedBody).toBe("string");
    expect(forwardedBody).toMatch(/\{\{SECRET_[bcdfghjkmnpqrstvwxz]{5}\}\}/);
    expect(forwardedBody).not.toContain(rawSecret);
    expect(mockForward).toHaveBeenCalledWith(
      "/v1/chat/completions",
      expect.any(NextRequest),
      expect.any(String)
    );
  });


  it("never forwards custom privacy meta fields for masked chat requests", async () => {
    const rawPhone = "13912345678";

    const response = await POST(makeRequest("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are careful." },
          { role: "user", content: `phone: ${rawPhone}` },
        ],
      }),
    }));

    expect(response.status).toBe(200);
    const forwardedBody = mockForward.mock.calls[0]?.[2];
    expect(typeof forwardedBody).toBe("string");
    const parsed = JSON.parse(String(forwardedBody));
    expect(parsed).not.toHaveProperty("_privacy_meta");
    expect(JSON.stringify(parsed)).not.toContain(rawPhone);
    // Original messages preserved untouched, except the in-place mask
    expect(parsed.messages[0].content).toBe("You are careful.");
    const tagMatch = parsed.messages[1].content.match(/\{\{PHONE_[bcdfghjkmnpqrstvwxz]{5}\}\}/);
    expect(tagMatch).not.toBeNull();
    expect(parsed.messages[1].content).toContain("phone:");
    // Notice appended as a new system message at the tail, sampled with the real issued tag
    const lastMsg = parsed.messages[parsed.messages.length - 1];
    expect(lastMsg.role).toBe("system");
    expect(lastMsg.content).toContain("[Privacy notice]");
    expect(lastMsg.content).toContain(tagMatch![0]);
  });
});
