import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/config-loader", () => ({ initializeConfigs: vi.fn() }));
vi.mock("@/audit/retention", () => ({ initRetentionScheduler: vi.fn() }));
vi.mock("@/audit/logger", () => ({ logAudit: vi.fn(() => 1), recordRestoreStats: vi.fn() }));
vi.mock("@/bypass/store", () => ({ findMatchingBypassRule: vi.fn(() => null) }));
vi.mock("@/proxy/channels", () => ({ resolveChannel: vi.fn() }));
vi.mock("@/proxy/forwarder", () => ({ forwardRequest: vi.fn() }));

import { POST } from "@/app/[...path]/route";
import { forwardRequest } from "@/proxy/forwarder";
import { resolveChannel } from "@/proxy/channels";
import { logAudit } from "@/audit/logger";

const mockForward = vi.mocked(forwardRequest);
const mockResolve = vi.mocked(resolveChannel);
const mockLogAudit = vi.mocked(logAudit);

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
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

  it("returns 404 without forwarding or auditing when no channel and no default upstream (enumeration hardening)", async () => {
    const saved = process.env.UPSTREAM_URL;
    delete process.env.UPSTREAM_URL;
    try {
      mockResolve.mockReturnValue(null);
      const res = await POST(makeRequest("/v1/chat/completions"));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
      expect(mockForward).not.toHaveBeenCalled();
      expect(mockLogAudit).not.toHaveBeenCalled();
    } finally {
      process.env.UPSTREAM_URL = saved;
    }
  });

  it("channel routing still works without default upstream", async () => {
    const saved = process.env.UPSTREAM_URL;
    delete process.env.UPSTREAM_URL;
    try {
      mockResolve.mockReturnValue(CHANNEL);
      const res = await POST(makeRequest("/relay/v1/chat/completions"));
      expect(res.status).toBe(200);
      expect(mockForward).toHaveBeenCalled();
    } finally {
      process.env.UPSTREAM_URL = saved;
    }
  });
});
