import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET as configGET } from "@/app/api/admin/config/route";
import { GET as statsGET } from "@/app/api/admin/stats/route";
import { getDbStats, getAuditStats } from "@/audit";
import { statSync } from "fs";

vi.mock("@/audit", () => ({
  getDbStats: vi.fn(),
  getAuditStats: vi.fn(),
  getAllConfigs: vi.fn(() => []),
  setConfig: vi.fn(),
}));

vi.mock("@/config-loader", () => ({
  initializeConfigs: vi.fn(),
  refreshConfig: vi.fn(),
}));

vi.mock("@/log", () => ({
  Logger: class {
    error = vi.fn();
    warn = vi.fn();
    info = vi.fn();
    debug = vi.fn();
  },
}));

vi.mock("@/config", () => ({
  UPSTREAM_URL: "http://localhost:8787",
  DB_PATH: "/tmp/test.sqlite",
  DEBUG: false,
  SIZE_THRESHOLDS: {
    FULL_SCAN: 131072,
    CHUNKED_SCAN: 1048576,
  },
  CONFIG_STATE: {
    CHUNK_SIZE: 65536,
  },
  CONTEXT_KEY: {
    MIN_LENGTH: 8,
    MAX_LENGTH: 200,
    MAX_SPACES: 2,
  },
  PATH_PREFIX_OPTIONS: ["/v1/messages", "/v1/responses", "/v1beta"],
  SCANNER_EXCLUSIONS: [],
}));

vi.mock("fs", () => ({
  statSync: vi.fn(),
}));

function makeRequest(adminKey?: string): Request {
  const headers: Record<string, string> = {};
  if (adminKey) headers["x-admin-key"] = adminKey;
  return new Request("http://localhost:3000/api/admin/test", { headers });
}

describe("admin config and stats routes", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ADMIN_KEY;
    process.env.ADMIN_KEY = "test-key";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.ADMIN_KEY = originalKey;
  });

  describe("admin config GET", () => {
    it("returns 503 when ADMIN_KEY is not set", async () => {
      delete process.env.ADMIN_KEY;
      const res = await configGET(makeRequest("test-key"));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "admin_not_configured" });
    });

    it("returns 401 when x-admin-key does not match", async () => {
      const res = await configGET(makeRequest("wrong-key"));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });

    it("returns env, constants, and dbStats", async () => {
      vi.mocked(getDbStats).mockReturnValue({
        totalRecords: 100,
        earliestRecord: "2024-01-01",
        latestRecord: "2024-12-31",
      });
      vi.mocked(statSync).mockReturnValue({ size: 4096 } as any);

      const res = await configGET(makeRequest("test-key"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({
        env: {
          upstreamUrl: "http://localhost:8787",
          dbPath: "/tmp/test.sqlite",
          debug: false,
          nodeEnv: "test",
          port: "3000",
        },
        editableConfigs: {
          path_prefix_options: { value: ["/v1/messages", "/v1/responses", "/v1beta"], type: "json_array" },
          size_threshold_full_scan: { value: 131072, type: "number" },
          size_threshold_chunked_scan: { value: 1048576, type: "number" },
          chunk_size: { value: 65536, type: "number" },
          context_key_min_length: { value: 8, type: "number" },
          context_key_max_length: { value: 200, type: "number" },
          context_key_max_spaces: { value: 2, type: "number" },
          scanner_exclusions: { value: [], type: "json_array" },
        },
        constants: {
          sizeThresholds: { fullScan: 131072, chunkedScan: 1048576 },
          chunkSize: 65536,
          contextKey: { minLength: 8, maxLength: 200, maxSpaces: 2 },
        },
        dbStats: {
          totalRecords: 100,
          earliestRecord: "2024-01-01",
          latestRecord: "2024-12-31",
          dbFileSize: 4096,
        },
      });
    });

    it("returns dbFileSize 0 when statSync fails", async () => {
      vi.mocked(getDbStats).mockReturnValue({
        totalRecords: 100,
        earliestRecord: "2024-01-01",
        latestRecord: "2024-12-31",
      });
      vi.mocked(statSync).mockImplementation(() => {
        throw new Error("not found");
      });

      const res = await configGET(makeRequest("test-key"));
      const json = await res.json();
      expect(json.dbStats.dbFileSize).toBe(0);
    });

    it("returns 500 on db error", async () => {
      vi.mocked(getDbStats).mockImplementation(() => {
        throw new Error("db fail");
      });
      const res = await configGET(makeRequest("test-key"));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "db_error" });
    });
  });

  describe("admin stats GET", () => {
    it("returns 503 when ADMIN_KEY is not set", async () => {
      delete process.env.ADMIN_KEY;
      const res = await statsGET(makeRequest("test-key"));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "admin_not_configured" });
    });

    it("returns 401 when x-admin-key does not match", async () => {
      const res = await statsGET(makeRequest("wrong-key"));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });

    it("returns audit stats", async () => {
      vi.mocked(getAuditStats).mockReturnValue({
        total: 50,
        blocked: 10,
        masked: 20,
        allowed: 20,
      });
      const res = await statsGET(makeRequest("test-key"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        total: 50,
        blocked: 10,
        masked: 20,
        allowed: 20,
      });
    });

    it("returns 500 on db error", async () => {
      vi.mocked(getAuditStats).mockImplementation(() => {
        throw new Error("db fail");
      });
      const res = await statsGET(makeRequest("test-key"));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "db_error" });
    });
  });
});
