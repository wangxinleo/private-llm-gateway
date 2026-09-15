import { getDb } from "@/audit/store";

export interface UpstreamRow {
  id: number;
  name: string;
  target: string;
  extra_headers: string;
  enabled: number;
  created_at: string;
}

export interface UpstreamInput {
  name: string;
  target: string;
  extraHeaders?: Record<string, string>;
  enabled?: boolean;
}

// 进程内版本号:任何写操作自增,channels 侧列表缓存据此失效(热加载)
let contentVersion = 0;

export function getUpstreamsVersion(): number {
  return contentVersion;
}

export function listUpstreams(): UpstreamRow[] {
  return getDb().prepare("SELECT * FROM upstreams ORDER BY name").all() as UpstreamRow[];
}

export function listEnabledUpstreams(): UpstreamRow[] {
  return getDb().prepare("SELECT * FROM upstreams WHERE enabled = 1 ORDER BY name").all() as UpstreamRow[];
}

export function getUpstreamByName(name: string): UpstreamRow | null {
  return (getDb().prepare("SELECT * FROM upstreams WHERE name = ?").get(name) as UpstreamRow | undefined) ?? null;
}

export function createUpstream(input: UpstreamInput): UpstreamRow {
  const db = getDb();
  const result = db
    .prepare("INSERT INTO upstreams (name, target, extra_headers, enabled) VALUES (?, ?, ?, ?)")
    .run(input.name, input.target, JSON.stringify(input.extraHeaders ?? {}), input.enabled === false ? 0 : 1);
  contentVersion += 1;
  return db.prepare("SELECT * FROM upstreams WHERE id = ?").get(Number(result.lastInsertRowid)) as UpstreamRow;
}

export function updateUpstream(
  id: number,
  patch: { name?: string; target?: string; extraHeaders?: Record<string, string>; enabled?: boolean }
): UpstreamRow | null {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM upstreams WHERE id = ?").get(id) as UpstreamRow | undefined;
  if (!existing) return null;
  const next = {
    name: patch.name ?? existing.name,
    target: patch.target ?? existing.target,
    extra_headers: patch.extraHeaders === undefined ? existing.extra_headers : JSON.stringify(patch.extraHeaders),
    enabled: patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0,
  };
  db.prepare("UPDATE upstreams SET name = ?, target = ?, extra_headers = ?, enabled = ? WHERE id = ?")
    .run(next.name, next.target, next.extra_headers, next.enabled, id);
  contentVersion += 1;
  return db.prepare("SELECT * FROM upstreams WHERE id = ?").get(id) as UpstreamRow;
}

export function deleteUpstream(id: number): boolean {
  const result = getDb().prepare("DELETE FROM upstreams WHERE id = ?").run(id);
  if (result.changes > 0) {
    contentVersion += 1;
    return true;
  }
  return false;
}
