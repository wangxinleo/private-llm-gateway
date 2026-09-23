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

import { POST } from "@/app/[...path]/route";
import { forwardRequest } from "@/proxy/forwarder";
import { findMatchingBypassRule } from "@/bypass/store";
import { maskJsonBody } from "@/scanner/json-mask";
import { RUNTIME } from "@/config";

vi.mock("@/scanner/json-mask", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/scanner/json-mask")>();
  return { ...actual, maskJsonBody: vi.fn(actual.maskJsonBody), __actualMaskJson: actual.maskJsonBody };
});

const actualMaskJson = (await import("@/scanner/json-mask") as unknown as {
  __actualMaskJson: typeof maskJsonBody;
}).__actualMaskJson;
const mockForward = vi.mocked(forwardRequest);
const mockFindBypass = vi.mocked(findMatchingBypassRule);
const mockMaskJson = vi.mocked(maskJsonBody);

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function makeRequest(init?: NextRequestInit): NextRequest {
  return new NextRequest("http://localhost:3000/v1/chat/completions", init);
}

function jsonRequest(body: unknown, headers?: Record<string, string>): NextRequest {
  return makeRequest({
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("engine hardening (413 + fail_closed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaskJson.mockImplementation(actualMaskJson);
    RUNTIME.failClosed = true;
    RUNTIME.maxBodyBytes = 32 * 1024 * 1024;
    mockFindBypass.mockReturnValue(null);
    mockForward.mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    );
  });

  it("rejects requests whose declared content-length exceeds the limit with 413", async () => {
    RUNTIME.maxBodyBytes = 1024;
    const response = await POST(
      jsonRequest({ messages: [] }, { "content-length": String(10 * 1024) })
    );
    expect(response.status).toBe(413);
    expect(mockForward).not.toHaveBeenCalled();
  });

  it("rejects requests whose measured body size exceeds the limit with 413", async () => {
    RUNTIME.maxBodyBytes = 16;
    const response = await POST(jsonRequest({ messages: [{ role: "user", content: "x".repeat(256) }] }));
    expect(response.status).toBe(413);
    expect(mockForward).not.toHaveBeenCalled();
  });

  it("returns 503 mask_failed when scanning throws and fail_closed is on", async () => {
    mockMaskJson.mockImplementation(() => {
      throw new Error("injected scanner fault");
    });
    const response = await POST(jsonRequest({ messages: [] }));
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload).toEqual({ error: "mask_failed" });
    expect(mockForward).not.toHaveBeenCalled();
  });

  it("forwards the original plaintext when scanning throws and fail_closed is off", async () => {
    RUNTIME.failClosed = false;
    mockMaskJson.mockImplementation(() => {
      throw new Error("injected scanner fault");
    });
    const raw = JSON.stringify({ messages: [{ role: "user", content: "13800138000" }] });
    const response = await POST(
      makeRequest({ method: "POST", headers: { "content-type": "application/json" }, body: raw })
    );
    expect(response.status).toBe(200);
    expect(mockForward).toHaveBeenCalled();
    expect(mockForward.mock.calls[0]?.[2]).toBe(raw);
  });

  it("still scans unknown-shape JSON bodies (fail-closed must not depend on path whitelists)", async () => {
    const response = await POST(
      jsonRequest({ text: "联系张三 13800138000，邮箱 foo@bar.com" })
    );
    expect(response.status).toBe(200);
    const forwarded = mockForward.mock.calls[0]?.[2];
    expect(typeof forwarded).toBe("string");
    expect(forwarded).not.toContain("13800138000");
  });
});
