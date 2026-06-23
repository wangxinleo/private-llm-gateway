import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/admin/bypass-rules/route";
import { PATCH, DELETE } from "@/app/api/admin/bypass-rules/[id]/route";
import {
  listBypassRules,
  createBypassRule,
  updateBypassRule,
  deleteBypassRule,
} from "@/bypass/store";

vi.mock("@/bypass/store", () => ({
  listBypassRules: vi.fn(),
  createBypassRule: vi.fn(),
  updateBypassRule: vi.fn(),
  deleteBypassRule: vi.fn(),
}));

vi.mock("@/log", () => ({
  Logger: class {
    error = vi.fn();
    warn = vi.fn();
    info = vi.fn();
    debug = vi.fn();
  }
}));

const mockListBypassRules = vi.mocked(listBypassRules);
const mockCreateBypassRule = vi.mocked(createBypassRule);
const mockUpdateBypassRule = vi.mocked(updateBypassRule);
const mockDeleteBypassRule = vi.mocked(deleteBypassRule);

function makeRequest(
  path: string,
  method: string,
  options?: { adminKey?: string; body?: Record<string, unknown> }
): NextRequest {
  const headers: Record<string, string> = {};
  if (options?.adminKey) headers["x-admin-key"] = options.adminKey;
  if (options?.body) headers["content-type"] = "application/json";

  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
}

describe("admin bypass rules routes", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ADMIN_KEY;
    process.env.ADMIN_KEY = "test-key";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.ADMIN_KEY = originalKey;
  });

  it("GET returns 401 when admin key mismatches", async () => {
    const res = await GET(makeRequest("/api/admin/bypass-rules", "GET", { adminKey: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("GET returns current rules", async () => {
    mockListBypassRules.mockReturnValue([
      {
        id: 1,
        enabled: 1,
        pathPrefix: "/v1/chat",
        modelName: "gpt-4o-mini",
        startAt: "2026-06-22T02:00:00.000Z",
        endAt: "2026-06-22T10:00:00.000Z",
        note: "maintenance",
        createdAt: "2026-06-22T01:00:00.000Z",
        updatedAt: "2026-06-22T01:00:00.000Z",
      },
    ]);

    const res = await GET(makeRequest("/api/admin/bypass-rules", "GET", { adminKey: "test-key" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: expect.any(Array) });
  });

  it("POST validates required fields", async () => {
    const res = await POST(
      makeRequest("/api/admin/bypass-rules", "POST", {
        adminKey: "test-key",
        body: { pathPrefix: "/v1/chat" },
      })
    );

    expect(res.status).toBe(400);
  });

  it("POST creates a bypass rule", async () => {
    mockCreateBypassRule.mockReturnValue({
      id: 3,
      enabled: 1,
      pathPrefix: "/v1/chat",
      modelName: "gpt-4o-mini",
      startAt: "2026-06-22T02:00:00.000Z",
      endAt: "2026-06-22T10:00:00.000Z",
      note: "maintenance",
      createdAt: "2026-06-22T01:00:00.000Z",
      updatedAt: "2026-06-22T01:00:00.000Z",
    });

    const res = await POST(
      makeRequest("/api/admin/bypass-rules", "POST", {
        adminKey: "test-key",
        body: {
          pathPrefix: "/v1/chat",
          modelName: "gpt-4o-mini",
          startAt: "2026-06-22T02:00:00.000Z",
          endAt: "2026-06-22T10:00:00.000Z",
          note: "maintenance",
          enabled: true,
        },
      })
    );

    expect(res.status).toBe(201);
    expect(mockCreateBypassRule).toHaveBeenCalledWith(
      expect.objectContaining({
        pathPrefix: "/v1/chat",
        modelName: "gpt-4o-mini",
      })
    );
  });

  it("PATCH updates an existing rule", async () => {
    mockUpdateBypassRule.mockReturnValue({
      id: 3,
      enabled: 0,
      pathPrefix: "/v1/chat",
      modelName: "gpt-4o-mini",
      startAt: "2026-06-22T02:00:00.000Z",
      endAt: "2026-06-22T10:00:00.000Z",
      note: "disabled",
      createdAt: "2026-06-22T01:00:00.000Z",
      updatedAt: "2026-06-22T03:00:00.000Z",
    });

    const res = await PATCH(
      makeRequest("/api/admin/bypass-rules/3", "PATCH", {
        adminKey: "test-key",
        body: { enabled: false, note: "disabled" },
      }),
      { params: Promise.resolve({ id: "3" }) }
    );

    expect(res.status).toBe(200);
    expect(mockUpdateBypassRule).toHaveBeenCalledWith(3, {
      enabled: false,
      note: "disabled",
    });
  });

  it("DELETE removes an existing rule", async () => {
    mockDeleteBypassRule.mockReturnValue(true);

    const res = await DELETE(
      makeRequest("/api/admin/bypass-rules/3", "DELETE", { adminKey: "test-key" }),
      { params: Promise.resolve({ id: "3" }) }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(mockDeleteBypassRule).toHaveBeenCalledWith(3);
  });
});
