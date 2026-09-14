import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/config-loader", () => ({
  initializeConfigs: vi.fn(),
}));

vi.mock("@/audit/retention", () => ({
  initRetentionScheduler: vi.fn(),
}));

vi.mock("@/proxy/forwarder", () => ({
  forwardRequest: vi.fn(),
}));

vi.mock("@/audit/logger", () => ({
  logAudit: vi.fn(),
}));

vi.mock("@/bypass/store", () => ({
  findMatchingBypassRule: vi.fn(),
}));

import { POST } from "@/app/api/[[...path]]/route";
import { forwardRequest } from "@/proxy/forwarder";
import { findMatchingBypassRule } from "@/bypass/store";

const mockForward = vi.mocked(forwardRequest);
const mockFindMatchingBypassRule = vi.mocked(findMatchingBypassRule);

function makeMultipartRequest(fields: Record<string, string>, files: Record<string, { content: string; filename: string; type: string }>): NextRequest {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const [key, { content, filename, type }] of Object.entries(files)) {
    form.append(key, new File([content], filename, { type }));
  }
  return new NextRequest("http://localhost:3000/api/v1/upload", {
    method: "POST",
    body: form,
  });
}

describe("proxy route multipart forwarding", () => {
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

  it("forwards a FormData preserving fields and file for multipart allow", async () => {
    const request = makeMultipartRequest(
      { message: "hello world" },
      { file: { content: "fake binary content 12345", filename: "test.png", type: "image/png" } }
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const call = mockForward.mock.calls[0];
    expect(call?.[0]).toBe("/v1/upload");
    expect(call?.[2]).toBeInstanceOf(FormData);
    const forwarded = call?.[2] as FormData;
    expect(String(forwarded.get("message"))).toBe("hello world");
    const file = forwarded.get("file");
    expect(file).toBeInstanceOf(File);
    expect(await (file as File).text()).toBe("fake binary content 12345");
  });

  it("rebuilds a masked FormData for multipart mask, preserving the file", async () => {
    const rawKey = "sk-proj-" + "a".repeat(24);
    const request = makeMultipartRequest(
      { message: `api_key: ${rawKey}` },
      { file: { content: "fake binary content 12345", filename: "test.png", type: "image/png" } }
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const call = mockForward.mock.calls[0];
    expect(call?.[0]).toBe("/v1/upload");
    expect(call?.[2]).toBeInstanceOf(FormData);
    const forwarded = call?.[2] as FormData;
    const maskedMessage = String(forwarded.get("message"));
    expect(maskedMessage).toMatch(/\{\{API_KEY_[bcdfghjkmnpqrstvwxz]{5}\}\}/);
    expect(maskedMessage).not.toContain(rawKey);
    const file = forwarded.get("file");
    expect(file).toBeInstanceOf(File);
    expect(await (file as File).text()).toBe("fake binary content 12345");
    expect((file as File).name).toBe("test.png");
  });

  it("forwards a FormData preserving fields and file for multipart bypass", async () => {
    mockFindMatchingBypassRule.mockReturnValue({
      id: 1,
      enabled: 1,
      pathPrefix: "/v1",
      modelName: "*",
      startAt: "2000-01-01T00:00:00Z",
      endAt: "2999-01-01T00:00:00Z",
      note: "",
      createdAt: "",
      updatedAt: "",
    });
    const request = makeMultipartRequest(
      { message: "hello world" },
      { file: { content: "fake binary content 12345", filename: "test.png", type: "image/png" } }
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const call = mockForward.mock.calls[0];
    expect(call?.[0]).toBe("/v1/upload");
    expect(call?.[2]).toBeInstanceOf(FormData);
    const forwarded = call?.[2] as FormData;
    expect(await (forwarded.get("file") as File).text()).toBe("fake binary content 12345");
  });

  it("blocks multipart requests with sensitive filenames without forwarding", async () => {
    const request = makeMultipartRequest(
      { message: "hello world" },
      { file: { content: "x", filename: "secrets.env", type: "application/octet-stream" } }
    );

    const response = await POST(request);

    expect(mockForward).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.blocked_types).toContain("SENSITIVE_FILENAME");
  });
});