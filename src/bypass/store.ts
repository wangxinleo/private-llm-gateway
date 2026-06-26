import { getDb } from "@/audit";
import {
  matchBypassRule,
  isBypassRuleActive,
  type BypassRuleRecord,
} from "./rules";

export interface BypassRuleInput {
  enabled: boolean;
  pathPrefix: string;
  modelName: string;
  startAt: string;
  endAt: string;
  note?: string;
}

export interface BypassRuleUpdate {
  enabled?: boolean;
  pathPrefix?: string;
  modelName?: string;
  startAt?: string;
  endAt?: string;
  note?: string;
}

function ensureBypassRulesTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS bypass_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enabled INTEGER NOT NULL DEFAULT 1,
      path_prefix TEXT NOT NULL,
      model_name TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  getDb().exec(`
    CREATE INDEX IF NOT EXISTS idx_bypass_rules_enabled
    ON bypass_rules(enabled)
  `);
}

interface BypassRuleRow {
  id: number;
  enabled: number;
  path_prefix: string;
  model_name: string;
  start_at: string;
  end_at: string;
  note: string;
  created_at: string;
  updated_at: string;
}

function mapRuleRow(row: BypassRuleRow): BypassRuleRecord {
  return {
    id: row.id,
    enabled: row.enabled,
    pathPrefix: row.path_prefix,
    modelName: row.model_name,
    startAt: row.start_at,
    endAt: row.end_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listBypassRules(): Array<BypassRuleRecord & { isActive: boolean }> {
  ensureBypassRulesTable();
  const rows = getDb()
    .prepare("SELECT * FROM bypass_rules ORDER BY id DESC")
    .all() as BypassRuleRow[];

  const now = new Date();
  return rows.map((row) => {
    const mapped = mapRuleRow(row);
    return {
      ...mapped,
      isActive: isBypassRuleActive(mapped, now),
    };
  });
}

export function createBypassRule(input: BypassRuleInput): BypassRuleRecord {
  ensureBypassRulesTable();
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO bypass_rules (enabled, path_prefix, model_name, start_at, end_at, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.enabled ? 1 : 0,
      input.pathPrefix,
      input.modelName,
      input.startAt,
      input.endAt,
      input.note ?? "",
      now,
      now
    );

  const row = getDb()
    .prepare("SELECT * FROM bypass_rules WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as BypassRuleRow;
  return mapRuleRow(row);
}

export function updateBypassRule(
  id: number,
  updates: BypassRuleUpdate
): BypassRuleRecord | null {
  ensureBypassRulesTable();
  const current = getDb()
    .prepare("SELECT * FROM bypass_rules WHERE id = ?")
    .get(id) as BypassRuleRow | undefined;
  if (!current) return null;

  const next = {
    enabled: updates.enabled === undefined ? current.enabled : updates.enabled ? 1 : 0,
    pathPrefix: updates.pathPrefix ?? current.path_prefix,
    modelName: updates.modelName ?? current.model_name,
    startAt: updates.startAt ?? current.start_at,
    endAt: updates.endAt ?? current.end_at,
    note: updates.note ?? current.note,
    updatedAt: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `UPDATE bypass_rules
       SET enabled = ?, path_prefix = ?, model_name = ?, start_at = ?, end_at = ?, note = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.enabled,
      next.pathPrefix,
      next.modelName,
      next.startAt,
      next.endAt,
      next.note,
      next.updatedAt,
      id
    );

  const row = getDb()
    .prepare("SELECT * FROM bypass_rules WHERE id = ?")
    .get(id) as BypassRuleRow;
  return mapRuleRow(row);
}

export function reactivateBypassRule(id: number): BypassRuleRecord | null {
  ensureBypassRulesTable();
  const current = getDb()
    .prepare("SELECT * FROM bypass_rules WHERE id = ?")
    .get(id) as BypassRuleRow | undefined;
  if (!current) return null;

  const durationMs = Date.parse(current.end_at) - Date.parse(current.start_at);
  if (Number.isNaN(durationMs) || durationMs <= 0) return null;

  const now = new Date();
  const startAt = now.toISOString();
  const endAt = new Date(now.getTime() + durationMs).toISOString();

  getDb()
    .prepare(
      `UPDATE bypass_rules
       SET enabled = 1, start_at = ?, end_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(startAt, endAt, now.toISOString(), id);

  const row = getDb()
    .prepare("SELECT * FROM bypass_rules WHERE id = ?")
    .get(id) as BypassRuleRow;
  return mapRuleRow(row);
}

export function deleteBypassRule(id: number): boolean {
  ensureBypassRulesTable();
  const result = getDb().prepare("DELETE FROM bypass_rules WHERE id = ?").run(id);
  return result.changes > 0;
}

export function findMatchingBypassRule(params: {
  path: string;
  model: string | null;
  now: Date;
}): BypassRuleRecord | null {
  ensureBypassRulesTable();
  const rows = getDb().prepare("SELECT * FROM bypass_rules WHERE enabled = 1").all() as BypassRuleRow[];
  return matchBypassRule(
    rows.map(mapRuleRow),
    { path: params.path, model: params.model },
    params.now
  );
}
