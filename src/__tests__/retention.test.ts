import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";

vi.mock("@/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config")>();
  return { ...actual, DB_PATH: join(tmpdir(), `retention-test-${process.pid}`, "audit.sqlite") };
});

import { getDb, insertAudit } from "@/audit/store";
import type { AuditEntry } from "@/types";
import { initRetentionScheduler, pruneExpired } from "@/audit/retention";
import { RUNTIME } from "@/config";

const tmpDir = join(tmpdir(), `retention-test-${process.pid}`);

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true });
});

function insertRowAt(timestamp: string): void {
  const entry: AuditEntry = {
    timestamp,
    path: "/v1/chat/completions",
    method: "POST",
    contentType: "application/json",
    bodySize: 10,
    filenames: [],
    findings: [],
    matchedValues: {},
    action: "allow",
  };
  const id = insertAudit(entry);
  getDb()
    .prepare("INSERT INTO audit_signals (ts, audit_id, signal, severity, detail) VALUES (?, ?, ?, ?, ?)")
    .run(timestamp, id, "error_leak", "LOW", "{}");
}

function counts(): { audit: number; signals: number } {
  const db = getDb();
  return {
    audit: (db.prepare("SELECT COUNT(*) as c FROM audit_log").get() as { c: number }).c,
    signals: (db.prepare("SELECT COUNT(*) as c FROM audit_signals").get() as { c: number }).c,
  };
}

describe("retention", () => {
  afterAll(() => {
    getDb().close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    RUNTIME.logRetentionDays = 7;
  });

  it("deletes rows older than the retention window and keeps recent ones", () => {
    const now = Date.now();
    insertRowAt(new Date(now - 10 * 86_400_000).toISOString());
    insertRowAt(new Date(now - 1 * 86_400_000).toISOString());
    expect(counts()).toEqual({ audit: 2, signals: 2 });

    const { audit, signals } = pruneExpired();
    expect(audit).toBe(1);
    expect(signals).toBe(1);
    expect(counts()).toEqual({ audit: 1, signals: 1 });
  });

  it("keeps everything when retention days is 0 (forever)", () => {
    insertRowAt(new Date(Date.now() - 365 * 86_400_000).toISOString());
    RUNTIME.logRetentionDays = 0;
    expect(pruneExpired()).toEqual({ audit: 0, signals: 0 });
    expect(counts().audit).toBeGreaterThan(0);
  });

  it("scheduler is idempotent and safe to call repeatedly", () => {
    expect(() => {
      initRetentionScheduler();
      initRetentionScheduler();
    }).not.toThrow();
  });

  it("audit_log migration adds mask columns idempotently", () => {
    const db = getDb() as unknown as Database.Database;
    const columns = db.prepare("PRAGMA table_info(audit_log)").all() as Array<{ name: string }>;
    for (const name of ["mask_applied", "mask_categories", "mask_count"]) {
      expect(columns.some((c) => c.name === name)).toBe(true);
    }
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      path: "/p",
      method: "POST",
      contentType: "application/json",
      bodySize: 1,
      filenames: [],
      findings: ["PHONE"],
      matchedValues: {},
      action: "mask",
      maskApplied: true,
      maskCategories: ["PHONE"],
      maskCount: 3,
    };
    const id = insertAudit(entry);
    const row = db.prepare("SELECT mask_applied, mask_categories, mask_count FROM audit_log WHERE id = ?").get(id) as {
      mask_applied: number;
      mask_categories: string;
      mask_count: number;
    };
    expect(row.mask_applied).toBe(1);
    expect(JSON.parse(row.mask_categories)).toEqual(["PHONE"]);
    expect(row.mask_count).toBe(3);
  });
});
