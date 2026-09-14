import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("@/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config")>();
  return { ...actual, DB_PATH: join(tmpdir(), `signals-test-${process.pid}`, "audit.sqlite") };
});

import { getDb, insertAudit } from "@/audit/store";
import { countRecentBySeverity, insertSignals, isAboveSeverityFloor, listSignalsByAuditIds, querySignals } from "@/audit/signals-store";
import { analyzeResponse, StreamResponseAnalyzer } from "@/proxy/response-analysis";
import { MaskRegistry } from "@/scanner/mask-registry";
import { RUNTIME } from "@/config";

const tmpDir = join(tmpdir(), `signals-test-${process.pid}`);

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  getDb().exec("DELETE FROM audit_signals");
  getDb().exec("DELETE FROM audit_log");
  RUNTIME.severityFloor = "MEDIUM";
});

describe("analyzeResponse (passive signals)", () => {
  it("error_leak: 4xx body containing a secret yields CRITICAL; high-entropy yields HIGH", () => {
    const signals = analyzeResponse({
      status: 500,
      text: 'Error dump: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"',
      forwardValues: [],
    });
    expect(signals.some((s) => s.signal === "error_leak" && s.severity === "CRITICAL")).toBe(true);
    expect(signals.some((s) => s.signal === "error_leak" && s.severity === "HIGH")).toBe(true);
  });

  it("error_leak: 2xx never triggers", () => {
    const signals = analyzeResponse({ status: 200, text: "Bearer abcdefghijklmnopqrstuvwxyz123456", forwardValues: [] });
    expect(signals.some((s) => s.signal === "error_leak")).toBe(false);
  });

  it("identity_swap: model family mismatch detected; same family suppressed", () => {
    const mismatch = analyzeResponse({ status: 200, text: JSON.stringify({ model: "claude-3" }), forwardValues: [], requestModel: "gpt-4o" });
    expect(mismatch.some((s) => s.signal === "identity_swap")).toBe(true);
    const same = analyzeResponse({ status: 200, text: JSON.stringify({ model: "gpt-4o-mini" }), forwardValues: [], requestModel: "gpt-4o" });
    expect(same.some((s) => s.signal === "identity_swap")).toBe(false);
  });

  it("response_poison: bidi controls HIGH; zero-width runs MEDIUM; placeholder residual MEDIUM", () => {
    const bidi = analyzeResponse({ status: 200, text: "a\u202Eb", forwardValues: [] });
    expect(bidi.some((s) => s.signal === "response_poison" && s.severity === "HIGH")).toBe(true);
    const zeroWidth = analyzeResponse({ status: 200, text: "\u200B".repeat(10), forwardValues: [] });
    expect(zeroWidth.some((s) => s.signal === "response_poison" && s.severity === "MEDIUM")).toBe(true);
    const residual = analyzeResponse({ status: 200, text: "answer {{PHONE_qgqhn}} tail", forwardValues: [] });
    expect(residual.some((s) => s.signal === "response_poison" && s.detail.kind === "placeholder_residual")).toBe(true);
  });

  it("response_scan: model-invented PII flagged, echo of forwarded value suppressed", () => {
    const registry = new MaskRegistry();
    const phone = registry.tagFor("PHONE", "13800138000");
    const signals = analyzeResponse({
      status: 200,
      text: `customer ${phone} called, new number 13900001111`,
      forwardValues: ["13800138000"],
    });
    const scans = signals.filter((s) => s.signal === "response_scan");
    expect(scans.some((s) => (s.detail as { preview?: string }).preview?.includes("11"))).toBe(true);
    // 13800138000 是还原回声,不应告警;13900001111 是新值
    expect(scans.some((s) => (s.detail as { preview?: string }).preview?.includes("80"))).toBe(false);
    // detail 不落完整敏感值
    for (const s of scans) {
      expect(JSON.stringify(s.detail)).not.toContain("13900001111");
    }
  });

  it("dangerous_action: destructive command recorded as LOW", () => {
    const signals = analyzeResponse({ status: 200, text: "run: rm -rf / --no-preserve-root", forwardValues: [] });
    expect(signals.some((s) => s.signal === "dangerous_action" && s.severity === "LOW")).toBe(true);
  });

  it("never throws on hostile input", () => {
    expect(() =>
      analyzeResponse({ status: 500, text: "\u202E".repeat(100) + "Bearer xxx " + "(".repeat(50), forwardValues: [] })
    ).not.toThrow();
  });
});

describe("StreamResponseAnalyzer", () => {
  it("accumulates frames, tracks parse failures, persists at finish", () => {
    RUNTIME.severityFloor = "LOW"; // dangerous_action 为 LOW,需降低落库阈值
    const registry = new MaskRegistry();
    const auditId = insertAudit({
      timestamp: new Date().toISOString(),
      path: "/v1/chat/completions",
      method: "POST",
      contentType: "application/json",
      bodySize: 10,
      filenames: [],
      findings: [],
      matchedValues: {},
      action: "allow",
    });
    const analyzer = new StreamResponseAnalyzer({ status: 200, forwardValues: [] }, auditId);
    analyzer.observe('data: {"choices":[{"delta":{"content":"rm -rf /"}}]}\n\n');
    analyzer.observe("data: {broken json\n\n");
    const persisted = analyzer.finish();
    expect(persisted).toBeGreaterThan(0);
    const rows = listSignalsByAuditIds([auditId]);
    expect(rows.some((r) => r.signal === "dangerous_action")).toBe(true);
  });
});

describe("signals store", () => {
  it("insertSignals filters below severity floor", () => {
    const auditId = insertAudit({
      timestamp: new Date().toISOString(),
      path: "/p",
      method: "POST",
      contentType: "application/json",
      bodySize: 1,
      filenames: [],
      findings: [],
      matchedValues: {},
      action: "allow",
    });
    const inserted = insertSignals(auditId, [
      { signal: "response_scan", severity: "LOW", detail: {} },
      { signal: "identity_swap", severity: "MEDIUM", detail: {} },
    ]);
    expect(inserted).toBe(1);
    expect(listSignalsByAuditIds([auditId]).map((r) => r.signal)).toEqual(["identity_swap"]);
  });

  it("querySignals and countRecentBySeverity work", () => {
    RUNTIME.severityFloor = "LOW";
    const auditId = insertAudit({
      timestamp: new Date().toISOString(),
      path: "/p",
      method: "POST",
      contentType: "application/json",
      bodySize: 1,
      filenames: [],
      findings: [],
      matchedValues: {},
      action: "allow",
    });
    insertSignals(auditId, [{ signal: "response_scan", severity: "LOW", detail: {} }]);
    expect(querySignals({ signal: "response_scan" }).total).toBe(1);
    const counts = countRecentBySeverity(24);
    expect(counts.LOW).toBeGreaterThanOrEqual(1);
  });

  it("isAboveSeverityFloor respects ordering", () => {
    RUNTIME.severityFloor = "HIGH";
    expect(isAboveSeverityFloor("LOW")).toBe(false);
    expect(isAboveSeverityFloor("HIGH")).toBe(true);
    expect(isAboveSeverityFloor("CRITICAL")).toBe(true);
    RUNTIME.severityFloor = "MEDIUM";
  });
});
