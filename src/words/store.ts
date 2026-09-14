import { getDb } from "@/audit/store";
import { Logger } from "@/log";

const log = new Logger("words");

export interface CustomWordRow {
  id: number;
  label: string;
  value: string;
  kind: "word" | "regex";
  whole_word: number;
  enabled: number;
  created_at: string;
}

export interface CustomWordInput {
  label: string;
  value: string;
  kind: "word" | "regex";
  wholeWord?: boolean;
  enabled?: boolean;
}

// 进程内版本号:任何写操作自增,编译缓存据此失效(maskit 教训:按长度比较会漏掉等长换词)
let contentVersion = 0;

export function getWordsVersion(): number {
  return contentVersion;
}

function rowToWord(row: CustomWordRow): CustomWordRow {
  return row;
}

export function listWords(): CustomWordRow[] {
  return getDb().prepare("SELECT * FROM custom_words ORDER BY label, id").all() as CustomWordRow[];
}

export function createWord(input: CustomWordInput): CustomWordRow {
  const db = getDb();
  const result = db
    .prepare("INSERT INTO custom_words (label, value, kind, whole_word, enabled) VALUES (?, ?, ?, ?, ?)")
    .run(input.label, input.value, input.kind, input.wholeWord === true ? 1 : 0, input.enabled === false ? 0 : 1);
  contentVersion += 1;
  const id = Number(result.lastInsertRowid);
  return rowToWord(db.prepare("SELECT * FROM custom_words WHERE id = ?").get(id) as CustomWordRow);
}

export function bulkCreateWords(items: CustomWordInput[]): number {
  if (items.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO custom_words (label, value, kind, whole_word, enabled) VALUES (?, ?, ?, ?, ?)"
  );
  const tx = db.transaction((rows: CustomWordInput[]) => {
    for (const item of rows) {
      stmt.run(item.label, item.value, item.kind, item.wholeWord === true ? 1 : 0, item.enabled === false ? 0 : 1);
    }
  });
  tx(items);
  contentVersion += 1;
  return items.length;
}

export function updateWord(
  id: number,
  patch: Partial<Omit<CustomWordInput, "value">> & { value?: string }
): CustomWordRow | null {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM custom_words WHERE id = ?").get(id) as CustomWordRow | undefined;
  if (!existing) return null;
  const next = {
    label: patch.label ?? existing.label,
    value: patch.value ?? existing.value,
    kind: patch.kind ?? existing.kind,
    whole_word: patch.wholeWord === undefined ? existing.whole_word : patch.wholeWord ? 1 : 0,
    enabled: patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0,
  };
  db.prepare("UPDATE custom_words SET label = ?, value = ?, kind = ?, whole_word = ?, enabled = ? WHERE id = ?")
    .run(next.label, next.value, next.kind, next.whole_word, next.enabled, id);
  contentVersion += 1;
  return db.prepare("SELECT * FROM custom_words WHERE id = ?").get(id) as CustomWordRow;
}

export function deleteWord(id: number): boolean {
  const result = getDb().prepare("DELETE FROM custom_words WHERE id = ?").run(id);
  if (result.changes > 0) {
    contentVersion += 1;
    return true;
  }
  return false;
}

export function validateRegex(value: string): boolean {
  try {
    new RegExp(value, "gu");
    return true;
  } catch (err) {
    log.debug(`invalid custom regex rejected: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
