import type { Severity } from "@/types";
import { getDb } from "./store";
import { RUNTIME } from "@/config";
import { SEVERITY_ORDER } from "@/types";

export interface AuditSignal {
  signal: string;
  severity: Severity;
  detail: Record<string, unknown>;
}

const INSERT_SQL = `
  INSERT INTO audit_signals (ts, audit_id, signal, severity, detail)
  VALUES (?, ?, ?, ?, ?)
`;

export function insertSignals(auditId: number | null, signals: AuditSignal[]): number {
  if (signals.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(INSERT_SQL);
  const ts = new Date().toISOString();
  const tx = db.transaction((rows: AuditSignal[]) => {
    for (const s of rows) {
      stmt.run(ts, auditId, s.signal, s.severity, JSON.stringify(s.detail ?? {}));
    }
  });
  tx(signals);
  return signals.length;
}

export interface SignalRow {
  id: number;
  ts: string;
  audit_id: number | null;
  signal: string;
  severity: string;
  detail: string;
}

export function listSignalsByAuditIds(auditIds: number[]): SignalRow[] {
  if (auditIds.length === 0) return [];
  const db = getDb();
  const placeholders = auditIds.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM audit_signals WHERE audit_id IN (${placeholders}) ORDER BY id`)
    .all(...auditIds) as SignalRow[];
}

export interface SignalQueryParams {
  page?: number;
  limit?: number;
  signal?: string;
  severity?: string;
  from?: string;
  to?: string;
}

export function querySignals(params: SignalQueryParams): { rows: SignalRow[]; total: number } {
  const db = getDb();
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const values: unknown[] = [];
  if (params.signal) {
    conditions.push("signal = ?");
    values.push(params.signal);
  }
  if (params.severity) {
    conditions.push("severity = ?");
    values.push(params.severity);
  }
  if (params.from) {
    conditions.push("ts >= ?");
    values.push(params.from);
  }
  if (params.to) {
    conditions.push("ts <= ?");
    values.push(params.to);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (db.prepare(`SELECT COUNT(*) as c FROM audit_signals ${where}`).get(...values) as { c: number }).c;
  const rows = db
    .prepare(`SELECT * FROM audit_signals ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...values, limit, offset) as SignalRow[];
  return { rows, total };
}

export function countRecentBySeverity(hours: number = 24): Record<Severity, number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
  const rows = db
    .prepare("SELECT severity, COUNT(*) as c FROM audit_signals WHERE ts >= ? GROUP BY severity")
    .all(cutoff) as Array<{ severity: Severity; c: number }>;
  const out: Record<Severity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const row of rows) {
    if (row.severity in out) out[row.severity] = row.c;
  }
  return out;
}

export function pruneSignalsBefore(cutoff: string): number {
  return getDb().prepare("DELETE FROM audit_signals WHERE ts < ?").run(cutoff).changes;
}

export function pruneAuditBefore(cutoff: string): number {
  return getDb().prepare("DELETE FROM audit_log WHERE timestamp < ?").run(cutoff).changes;
}

export function isAboveSeverityFloor(severity: Severity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[RUNTIME.severityFloor];
}
