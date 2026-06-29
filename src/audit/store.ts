import Database from "better-sqlite3";
import { DB_PATH } from "@/config";
import type { AuditEntry, FindingCategory, ActionType } from "@/types";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        path TEXT NOT NULL,
        method TEXT NOT NULL,
        content_type TEXT NOT NULL,
        body_size INTEGER NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        filenames TEXT NOT NULL DEFAULT '[]',
        findings TEXT NOT NULL DEFAULT '[]',
        matched_values TEXT NOT NULL DEFAULT '{}',
        action TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('number', 'string', 'json_array')),
        description TEXT,
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const columns = db.prepare("PRAGMA table_info(audit_log)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "matched_values")) {
      db.exec("ALTER TABLE audit_log ADD COLUMN matched_values TEXT NOT NULL DEFAULT '{}'");
    }
    if (!columns.some((column) => column.name === "model")) {
      db.exec("ALTER TABLE audit_log ADD COLUMN model TEXT NOT NULL DEFAULT ''");
    }
    if (!columns.some((column) => column.name === "bypass_applied")) {
      db.exec("ALTER TABLE audit_log ADD COLUMN bypass_applied INTEGER NOT NULL DEFAULT 0");
    }
  }
  return db;
}

const INSERT_SQL = `
  INSERT INTO audit_log (timestamp, path, method, content_type, body_size, model, filenames, findings, matched_values, action, bypass_applied)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export function insertAudit(entry: AuditEntry): number {
  const stmt = getDb().prepare(INSERT_SQL);
  const result = stmt.run(
    entry.timestamp,
    entry.path,
    entry.method,
    entry.contentType,
    entry.bodySize,
    entry.model ?? "",
    JSON.stringify(entry.filenames),
    JSON.stringify(entry.findings),
    JSON.stringify(entry.matchedValues ?? {}),
    entry.action,
    entry.bypassApplied ? 1 : 0
  );
  return Number(result.lastInsertRowid);
}

export interface AuditRow {
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
}

export interface QueryParams {
  page?: number;
  limit?: number;
  action?: string;
  finding?: string;
  method?: string;
  q?: string;
  from?: string;
  to?: string;
}

export function queryAudit(params: QueryParams): { rows: AuditRow[]; total: number } {
  const db = getDb();
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.action) {
    conditions.push("action = ?");
    values.push(params.action);
  }
  if (params.finding) {
    conditions.push("findings LIKE ?");
    values.push(`%"${params.finding}"%`);
  }
  if (params.method) {
    conditions.push("method = ?");
    values.push(params.method.toUpperCase());
  }
  if (params.q) {
    const escaped = params.q.replace(/[%_]/g, (c) => `\\${c}`);
    conditions.push("path LIKE ?");
    values.push(`%${escaped}%`);
  }
  if (params.from) {
    conditions.push("timestamp >= ?");
    values.push(params.from);
  }
  if (params.to) {
    conditions.push("timestamp <= ?");
    values.push(params.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM audit_log ${where}`).get(...values) as { total: number };
  const rows = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...values, limit, offset) as AuditRow[];

  return { rows, total: countRow.total };
}

export interface DeleteFilter {
  before: string;
  action?: ActionType;
}

export function deleteAuditByIds(ids: number[]): number {
  if (ids.length === 0) return 0;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const result = db.prepare(`DELETE FROM audit_log WHERE id IN (${placeholders})`).run(...ids);
  return result.changes;
}

export function deleteAuditByFilter(filter: DeleteFilter): number {
  const db = getDb();
  const conditions = ["timestamp < ?"];
  const values: unknown[] = [filter.before];
  if (filter.action) {
    conditions.push("action = ?");
    values.push(filter.action);
  }
  const where = conditions.join(" AND ");
  const result = db.prepare(`DELETE FROM audit_log WHERE ${where}`).run(...values);
  return result.changes;
}

export function countAuditByFilter(filter: DeleteFilter): number {
  const db = getDb();
  const conditions = ["timestamp < ?"];
  const values: unknown[] = [filter.before];
  if (filter.action) {
    conditions.push("action = ?");
    values.push(filter.action);
  }
  const where = conditions.join(" AND ");
  const row = db.prepare(`SELECT COUNT(*) as total FROM audit_log WHERE ${where}`).get(...values) as { total: number };
  return row.total;
}

export function getAuditStats(): { total: number; blocked: number; masked: number; allowed: number } {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as c FROM audit_log").get() as { c: number }).c;
  const blocked = (db.prepare("SELECT COUNT(*) as c FROM audit_log WHERE action='block'").get() as { c: number }).c;
  const masked = (db.prepare("SELECT COUNT(*) as c FROM audit_log WHERE action='mask'").get() as { c: number }).c;
  const allowed = (db.prepare("SELECT COUNT(*) as c FROM audit_log WHERE action='allow'").get() as { c: number }).c;
  return { total, blocked, masked, allowed };
}

export function getRecentBlocked(limit: number = 10): AuditRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM audit_log WHERE action != 'allow' ORDER BY id DESC LIMIT ?").all(limit) as AuditRow[];
}

export function getDbStats(): { totalRecords: number; earliestRecord: string | null; latestRecord: string | null } {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as c FROM audit_log").get() as { c: number }).c;
  const earliest = (db.prepare("SELECT MIN(timestamp) as t FROM audit_log").get() as { t: string | null }).t;
  const latest = (db.prepare("SELECT MAX(timestamp) as t FROM audit_log").get() as { t: string | null }).t;
  return { totalRecords: total, earliestRecord: earliest, latestRecord: latest };
}

// System config functions
export interface SystemConfigRow {
  key: string;
  value: string;
  type: 'number' | 'string' | 'json_array';
  description: string | null;
  updatedAt: string;
}

export function getConfig(key: string): SystemConfigRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM system_config WHERE key = ?").get(key) as SystemConfigRow | undefined;
  return row ?? null;
}

export function getAllConfigs(): SystemConfigRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM system_config ORDER BY key").all() as SystemConfigRow[];
}

export function setConfig(key: string, value: string, type: 'number' | 'string' | 'json_array', description?: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO system_config (key, value, type, description, updatedAt)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      type = excluded.type,
      description = excluded.description,
      updatedAt = datetime('now')
  `);
  stmt.run(key, value, type, description ?? null);
}

export function deleteConfig(key: string): void {
  const db = getDb();
  db.prepare("DELETE FROM system_config WHERE key = ?").run(key);
}
