import Database from "better-sqlite3";
import { DB_PATH } from "@/config";
import type { AuditEntry } from "@/types";

let db: Database.Database | null = null;

function getDb(): Database.Database {
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
        filenames TEXT NOT NULL DEFAULT '[]',
        findings TEXT NOT NULL DEFAULT '[]',
        action TEXT NOT NULL
      )
    `);
  }
  return db;
}

const INSERT_SQL = `
  INSERT INTO audit_log (timestamp, path, method, content_type, body_size, filenames, findings, action)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

export function insertAudit(entry: AuditEntry): void {
  const stmt = getDb().prepare(INSERT_SQL);
  stmt.run(
    entry.timestamp,
    entry.path,
    entry.method,
    entry.contentType,
    entry.bodySize,
    JSON.stringify(entry.filenames),
    JSON.stringify(entry.findings),
    entry.action
  );
}
