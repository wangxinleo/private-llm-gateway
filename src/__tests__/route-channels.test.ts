import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/config-loader", () => ({ initializeConfigs: vi.fn() }));
vi.mock("@/audit/retention", () => ({ initRetentionScheduler: vi.fn() }));
vi.mock("@/audit/logger", () => ({ logAudit: vi.fn(() => 1) }));
vi.mock("@/bypass/store", () => ({ findMatchingBypassRule: vi.fn(() => null) }));
vi.mock("@/proxy/channels", () => ({ resolveChannel: vi.fn() }));
vi.mock("@/proxy/forwarder", () => ({ forwardRequest: vi.fn() }));

import { POST } from "@/app/api/[[...path]]/route";
import { forwardRequest } from "@/proxy/forwarder";
import { resolveChannel } from "@/proxy/channels";
import { logAudit } from "@/audit/logger";

const mockForward = vi.mocked(forwardRequest);
const mockResolve = vi.mocked(resolveChannel);
const mockLogAudit = vi.mocked(logAudit);

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "demo-model", messages: [{ role: "user", content: "hello" }] }),
  });
}

const CHANNEL = { name: "relay", target: "https://relay.example.test", forwardPath: "/v1/chat/completions", extraHeaders: {} };

describe("channel-aware forwarding (route integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogAudit.mockReturnValue(1);
    mockResolve.mockReturnValue(null);
    mockForward.mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  });

  it("passes the resolved channel to the forwarder while audit keeps the original path", async () => {
    mockResolve.mockReturnValue(CHANNEL);
    const response = await POST(makeRequest("/relay/v1/chat/completions"));

    expect(response.status).toBe(200);
    const call = mockForward.mock.calls[0]!;
    expect(call[0]).toBe("/relay/v1/chat/completions");
    expect(call[3]).toEqual(CHANNEL);
    expect(mockLogAudit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ path: "/relay/v1/chat/completions" })
    );
  });

  it("keeps 3-arg forwarding (legacy behavior) when no channel matches", async () => {
    mockResolve.mockReturnValue(null);
    await POST(makeRequest("/v1/chat/completions"));
    expect(mockForward.mock.calls[0]!.length).toBe(3);
  });
});
