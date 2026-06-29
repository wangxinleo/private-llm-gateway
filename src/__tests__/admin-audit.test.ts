import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, DELETE } from "@/app/api/admin/audit/route";
import { NextRequest } from "next/server";
import { queryAudit, deleteAuditByIds, deleteAuditByFilter, countAuditByFilter } from "@/audit";
import { checkRevealAuth } from "@/app/api/admin/reveal-auth/auth";

vi.mock("@/audit", () => ({
  queryAudit: vi.fn(),
  deleteAuditByIds: vi.fn(),
  deleteAuditByFilter: vi.fn(),
  countAuditByFilter: vi.fn(),
}));

vi.mock("@/app/api/admin/reveal-auth/auth", () => ({
  checkRevealAuth: vi.fn(() => false),
}));

vi.mock("@/log", () => ({
  Logger: class {
    error = vi.fn();
    warn = vi.fn();
    info = vi.fn();
    debug = vi.fn();
  },
}));

const mockQueryAudit = vi.mocked(queryAudit);
const mockDeleteByIds = vi.mocked(deleteAuditByIds);
const mockDeleteByFilter = vi.mocked(deleteAuditByFilter);
const mockCountByFilter = vi.mocked(countAuditByFilter);
const mockCheckRevealAuth = vi.mocked(checkRevealAuth);

const sampleRow = {
  id: 1,
  timestamp: "2024-06-01T00:00:00Z",
  path: "/v1/chat",
  method: "POST",
  content_type: "application/json",
  body_size: 100,
  model: "gpt-4o-mini",
  filenames: '["file.txt"]',
  findings: '["JWT"]',
  matched_values: '{"JWT":["eyJhbGciOiJIUzI1NiJ9.payload.sig"]}',
  action: "block",
  bypass_applied: 0,
};

function makeRequest(
  method: string,
  path: string,
  opts?: {
    body?: Record<string, unknown>;
    adminKey?: string;
    searchParams?: Record<string, string>;
  },
): NextRequest {
  const url = new URL(`http://localhost:3000${path}`);
  if (opts?.searchParams) {
    for (const [k, v] of Object.entries(opts.searchParams)) {
      url.searchParams.set(k, v);
    }
  }
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: {},
  };
  if (opts?.adminKey) init.headers["x-admin-key"] = opts.adminKey;
  if (opts?.body) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  return new NextRequest(url.toString(), init);
}

describe("admin audit routes", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ADMIN_KEY;
    process.env.ADMIN_KEY = "test-key";
    vi.clearAllMocks();
    mockCheckRevealAuth.mockReturnValue(false);
  });

  afterEach(() => {
    process.env.ADMIN_KEY = originalKey;
  });

  describe("audit GET", () => {
    it("returns 503 when ADMIN_KEY is not set", async () => {
      delete process.env.ADMIN_KEY;
      const req = makeRequest("GET", "/api/admin/audit", { adminKey: "test-key" });
      const res = await GET(req);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "admin_not_configured" });
    });

    it("returns 401 when x-admin-key does not match", async () => {
      const req = makeRequest("GET", "/api/admin/audit", { adminKey: "wrong" });
      const res = await GET(req);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });

    it("returns mapped rows with camelCase keys", async () => {
      mockQueryAudit.mockReturnValue({ rows: [sampleRow], total: 1 });
      const req = makeRequest("GET", "/api/admin/audit", { adminKey: "test-key" });
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({
        total: 1,
        page: 1,
        limit: 50,
      });
      expect(json.rows[0]).toEqual({
        id: 1,
        timestamp: "2024-06-01T00:00:00Z",
        path: "/v1/chat",
        method: "POST",
        contentType: "application/json",
        bodySize: 100,
        model: "gpt-4o-mini",
        filenames: ["file.txt"],
        findings: ["JWT"],
        action: "block",
        bypassApplied: false,
      });
    });

    it("omits matchedValues when reveal auth is not active", async () => {
      mockQueryAudit.mockReturnValue({ rows: [sampleRow], total: 1 });
      mockCheckRevealAuth.mockReturnValue(false);
      const req = makeRequest("GET", "/api/admin/audit", { adminKey: "test-key" });
      const res = await GET(req);
      const json = await res.json();
      expect(json.rows[0]).not.toHaveProperty("matchedValues");
    });

    it("returns matchedValues when reveal auth is active", async () => {
      mockQueryAudit.mockReturnValue({ rows: [sampleRow], total: 1 });
      mockCheckRevealAuth.mockReturnValue(true);
      const req = makeRequest("GET", "/api/admin/audit", { adminKey: "test-key" });
      const res = await GET(req);
      const json = await res.json();
      expect(json.rows[0]).toMatchObject({
        matchedValues: { JWT: ["eyJhbGciOiJIUzI1NiJ9.payload.sig"] },
      });
    });

    it("passes filter params to queryAudit", async () => {
      mockQueryAudit.mockReturnValue({ rows: [], total: 0 });
      const req = makeRequest("GET", "/api/admin/audit", {
        adminKey: "test-key",
        searchParams: {
          action: "block",
          method: "POST",
          q: "test",
          from: "2024-01-01",
          to: "2024-12-31",
        },
      });
      await GET(req);
      expect(mockQueryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "block",
          method: "POST",
          q: "test",
          from: "2024-01-01",
          to: "2024-12-31",
        }),
      );
    });

    it("returns 500 on db error", async () => {
      mockQueryAudit.mockImplementation(() => {
        throw new Error("db fail");
      });
      const req = makeRequest("GET", "/api/admin/audit", { adminKey: "test-key" });
      const res = await GET(req);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "db_error" });
    });
  });

  describe("audit DELETE", () => {
    it("returns 503 when ADMIN_KEY is not set", async () => {
      delete process.env.ADMIN_KEY;
      const req = makeRequest("DELETE", "/api/admin/audit", {
        adminKey: "test-key",
        body: { ids: [1] },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(503);
    });

    it("returns 401 when x-admin-key does not match", async () => {
      const req = makeRequest("DELETE", "/api/admin/audit", {
        adminKey: "wrong",
        body: { ids: [1] },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(401);
    });

    it("deletes by ids and returns count", async () => {
      mockDeleteByIds.mockReturnValue(3);
      const req = makeRequest("DELETE", "/api/admin/audit", {
        adminKey: "test-key",
        body: { ids: [1, 2, 3] },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: 3 });
    });

    it("dryRun by ids returns wouldDelete without calling deleteAuditByIds", async () => {
      const req = makeRequest("DELETE", "/api/admin/audit?dryRun=true", {
        adminKey: "test-key",
        body: { ids: [1, 2] },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ wouldDelete: 2 });
      expect(mockDeleteByIds).not.toHaveBeenCalled();
    });

    it("deletes by filter and returns count", async () => {
      mockDeleteByFilter.mockReturnValue(5);
      const req = makeRequest("DELETE", "/api/admin/audit", {
        adminKey: "test-key",
        body: { filter: { before: "2024-01-01" } },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: 5 });
    });

    it("dryRun by filter returns wouldDelete from countAuditByFilter", async () => {
      mockCountByFilter.mockReturnValue(10);
      const req = makeRequest("DELETE", "/api/admin/audit?dryRun=true", {
        adminKey: "test-key",
        body: { filter: { before: "2024-01-01", action: "block" } },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ wouldDelete: 10 });
      expect(mockDeleteByFilter).not.toHaveBeenCalled();
    });

    it("returns 400 when neither ids nor filter provided", async () => {
      const req = makeRequest("DELETE", "/api/admin/audit", {
        adminKey: "test-key",
        body: {},
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "must provide ids or filter" });
    });

    it("returns 400 when ids is not an array", async () => {
      const req = makeRequest("DELETE", "/api/admin/audit", {
        adminKey: "test-key",
        body: { ids: "not-array" },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "ids must be non-empty array" });
    });

    it("returns 400 when ids is empty array", async () => {
      const req = makeRequest("DELETE", "/api/admin/audit", {
        adminKey: "test-key",
        body: { ids: [] },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "ids must be non-empty array" });
    });

    it("returns 400 when ids contains non-integer", async () => {
      const req = makeRequest("DELETE", "/api/admin/audit", {
        adminKey: "test-key",
        body: { ids: [1, "abc"] },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "ids must be positive integers" });
    });

    it("returns 400 when ids contains zero", async () => {
      const req = makeRequest("DELETE", "/api/admin/audit", {
        adminKey: "test-key",
        body: { ids: [0] },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "ids must be positive integers" });
    });

    it("returns 400 when ids contains negative", async () => {
      const req = makeRequest("DELETE", "/api/admin/audit", {
        adminKey: "test-key",
        body: { ids: [-1] },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "ids must be positive integers" });
    });

    it("returns 400 when ids exceeds 1000", async () => {
      const req = makeRequest("DELETE", "/api/admin/audit", {
        adminKey: "test-key",
        body: { ids: new Array(1001).fill(1) },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "ids array exceeds 1000 limit" });
    });

    it("returns 400 when filter.before is missing", async () => {
      const req = makeRequest("DELETE", "/api/admin/audit", {
        adminKey: "test-key",
        body: { filter: { action: "block" } },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "filter.before is required" });
    });

    it("returns 500 on db error", async () => {
      mockDeleteByIds.mockImplementation(() => {
        throw new Error("db fail");
      });
      const req = makeRequest("DELETE", "/api/admin/audit", {
        adminKey: "test-key",
        body: { ids: [1] },
      });
      const res = await DELETE(req);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "db_error" });
    });
  });
});
