import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { AuditEntry } from "@/types";
import { maskMatchedValue } from "@/lib/matched-values";

interface AuditListResponse {
  rows: Array<{
    matchedValues?: Record<string, string[]>;
  }>;
}

interface AuditQueryResult {
  rows: Array<{
    id: number;
    timestamp: string;
    path: string;
    method: string;
    content_type: string;
    body_size: number;
    model: string;
    filenames: string;
    findings: string;
    matched_values: string;
    action: string;
    bypass_applied: number;
    duration: number | null;
  }>;
  total: number;
}

const insertAuditMock = vi.fn<(entry: AuditEntry) => number>();
const broadcastAuditMock = vi.fn<(event: Record<string, unknown>) => void>();
const queryAuditMock = vi.fn<(_params: unknown) => AuditQueryResult>();

function mockLoggerModule() {
  vi.doMock("@/log", () => ({
    Logger: class {
      error = vi.fn();
      warn = vi.fn();
      info = vi.fn();
      debug = vi.fn();
    },
  }));
}

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/audit", {
    headers: { "x-admin-key": "test-key" },
  });
}

describe("audit raw matched values", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ADMIN_KEY;
    process.env.ADMIN_KEY = "test-key";
    vi.resetModules();
    vi.clearAllMocks();
    insertAuditMock.mockReturnValue(42);
  });

  afterEach(() => {
    process.env.ADMIN_KEY = originalKey;
    vi.doUnmock("@/audit/store");
    vi.doUnmock("@/audit/sse");
    vi.doUnmock("@/audit");
    vi.doUnmock("@/app/api/admin/reveal-auth/auth");
    vi.doUnmock("@/log");
  });

  it("always persists raw matched values for leak statistics", async () => {
    vi.doMock("@/audit/store", () => ({
      insertAudit: insertAuditMock,
    }));
    vi.doMock("@/audit/sse", () => ({
      broadcastAudit: broadcastAuditMock,
    }));

    const { logAudit } = await import("@/audit/logger");

    logAudit({
      path: "/v1/chat/completions",
      method: "POST",
      contentType: "application/json",
      bodySize: 64,
      filenames: [],
      findings: [
        {
          category: "BEARER_TOKEN",
          action: "block",
          matched: "Bearer sample-token-for-test",
        },
      ],
      action: "block",
    });

    expect(insertAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        matchedValues: { BEARER_TOKEN: ["Bearer sample-token-for-test"] },
      }),
    );

    const event = broadcastAuditMock.mock.calls[0]?.[0] ?? {};
    expect(event).toEqual(
      expect.objectContaining({
        id: 42,
        findings: ["BEARER_TOKEN"],
        action: "block",
      }),
    );
    expect(event).not.toHaveProperty("matchedValues");
    expect(JSON.stringify(event)).not.toContain("sample-token-for-test");
  });

  it("returns matched values from admin audit API only when reveal auth is active", async () => {
    queryAuditMock.mockReturnValue({
      rows: [
        {
          id: 1,
          timestamp: "2024-06-01T00:00:00Z",
          path: "/v1/chat",
          method: "POST",
          content_type: "application/json",
          body_size: 100,
          model: "gpt-4o-mini",
          filenames: "[]",
          findings: '["BEARER_TOKEN"]',
          matched_values: '{"BEARER_TOKEN":["Bearer sample-token-for-test"]}',
          action: "block",
          bypass_applied: 0,
          duration: null,
        },
      ],
      total: 1,
    });

    vi.doMock("@/audit", () => ({
      queryAudit: queryAuditMock,
      deleteAuditByIds: vi.fn(),
      deleteAuditByFilter: vi.fn(),
      countAuditByFilter: vi.fn(),
    }));
    vi.doMock("@/app/api/admin/reveal-auth/auth", () => ({
      checkRevealAuth: vi.fn(() => true),
    }));
    mockLoggerModule();

    const { GET } = await import("@/app/api/admin/audit/route");
    const res = await GET(makeRequest());
    const json = (await res.json()) as AuditListResponse;

    expect(res.status).toBe(200);
    expect(json.rows[0]?.matchedValues).toEqual({
      BEARER_TOKEN: ["Bearer sample-token-for-test"],
    });
  });

  it("masks matched values with double asterisks for UI display", () => {
    expect(maskMatchedValue("abcd")).toBe("**");
    expect(maskMatchedValue("abcdefgh")).toBe("ab**gh");
    expect(maskMatchedValue("Bearer sample-token-for-test")).toBe("Bear**test");
  });
});
