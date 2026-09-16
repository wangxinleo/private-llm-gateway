"use client";

import { useEffect, useState } from "react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocale } from "@/i18n";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { getErrorText } from "@/lib/admin-config";

interface Upstream {
  id: number;
  name: string;
  target: string;
  extra_headers: string;
  enabled: number;
  created_at: string;
}

const EMPTY_FORM = { name: "", target: "", extraHeaders: "" };

const PREFIX_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

// 随机入口前缀:24 位约 10^37 组合,外网无法枚举常见路径
function generateRandomPrefix(length = 24): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PREFIX_CHARS[bytes[i]! % PREFIX_CHARS.length];
  }
  return out;
}

function headersPreview(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const keys = Object.keys(parsed);
    return keys.length === 0 ? "—" : keys.join(", ");
  } catch {
    return "—";
  }
}

export default function ClientsPage() {
  const { t } = useLocale();
  const { authedFetch } = useAdminAuth();
  const [upstreams, setUpstreams] = useState<Upstream[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [defaultUpstream, setDefaultUpstream] = useState<string | null>(null);

  async function loadUpstreams() {
    setLoading(true);
    setError("");
    try {
      const res = await authedFetch("/api/admin/upstreams");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUpstreams(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      setError(t("clients.loadError"));
    } finally {
      setLoading(false);
    }
  }

  async function loadDefaultUpstream() {
    try {
      const res = await authedFetch("/api/admin/config");
      if (!res.ok) return;
      const data = await res.json();
      const value = data?.env?.upstreamUrl;
      setDefaultUpstream(typeof value === "string" && value.length > 0 ? value : null);
    } catch {
      /* 默认上游仅展示用途,加载失败不阻塞 */
    }
  }

  useEffect(() => {
    loadUpstreams();
    loadDefaultUpstream();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function parseHeadersDraft(): Record<string, string> | null {
    const trimmed = form.extraHeaders.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      for (const v of Object.values(parsed)) {
        if (typeof v !== "string") return null;
      }
      return parsed as Record<string, string>;
    } catch {
      return null;
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const extraHeaders = parseHeadersDraft();
    if (extraHeaders === null) {
      setError(t("clients.invalidHeaders"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await authedFetch("/api/admin/upstreams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), target: form.target.trim(), extraHeaders }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(getErrorText(payload) ?? t("clients.saveError"));
        return;
      }
      setForm(EMPTY_FORM);
      await loadUpstreams();
    } catch {
      setError(t("clients.saveError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(upstream: Upstream) {
    try {
      const res = await authedFetch("/api/admin/upstreams", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: upstream.id, enabled: upstream.enabled !== 1 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadUpstreams();
    } catch {
      setError(t("clients.saveError"));
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await authedFetch(`/api/admin/upstreams?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadUpstreams();
    } catch {
      setError(t("clients.deleteError"));
    }
  }

  return (
    <div className="space-y-6">
      {/* 默认上游(环境变量)状态:回填入口 + 防枚举模式说明 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("clients.defaultUpstream")}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {defaultUpstream
              ? t("clients.defaultUpstreamSet").replace("{target}", defaultUpstream)
              : t("clients.defaultUpstreamNone")}
          </p>
        </CardHeader>
        {defaultUpstream && (
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setForm({ name: generateRandomPrefix(), target: defaultUpstream, extraHeaders: "" })}
            >
              {t("clients.importDefault")}
            </Button>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("clients.createTitle")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("clients.createDesc")}</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleCreate}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("clients.name")}</span>
                <div className="flex gap-2">
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="relay-a"
                    maxLength={64}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setForm((prev) => ({ ...prev, name: generateRandomPrefix() }))}
                  >
                    {t("clients.generate")}
                  </Button>
                </div>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("clients.target")}</span>
                <Input
                  value={form.target}
                  onChange={(e) => setForm((prev) => ({ ...prev, target: e.target.value }))}
                  placeholder="https://api.example.com"
                />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t("clients.headers")}</span>
              <textarea
                value={form.extraHeaders}
                onChange={(e) => setForm((prev) => ({ ...prev, extraHeaders: e.target.value }))}
                placeholder='{"x-org-id": "acme"}'
                rows={3}
                className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={submitting || !form.name.trim() || !form.target.trim()}>
                {submitting ? t("clients.submitting") : t("clients.createAction")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t("clients.hint").replace("{name}", form.name.trim() || "<name>")}
              </p>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("clients.listTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <div className="h-9 animate-pulse rounded-md bg-muted/50" />
              <div className="h-9 animate-pulse rounded-md bg-muted/40" />
            </div>
          ) : upstreams.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center">
              <p className="text-sm font-medium text-foreground">{t("clients.empty")}</p>
              <p className="mx-auto mt-1 max-w-[48ch] text-xs leading-5 text-muted-foreground">{t("clients.emptyHint")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("clients.name")}</TableHead>
                  <TableHead>{t("clients.target")}</TableHead>
                  <TableHead>{t("clients.headers")}</TableHead>
                  <TableHead>{t("clients.status")}</TableHead>
                  <TableHead>{t("clients.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upstreams.map((upstream) => (
                  <TableRow key={upstream.id}>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">/{upstream.name}/...</code>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate">
                      <code className="font-mono text-xs">{upstream.target}</code>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {headersPreview(upstream.extra_headers)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={upstream.enabled === 1 ? "success" : "outline"} className="font-mono text-xs">
                        {upstream.enabled === 1 ? t("clients.enabled") : t("clients.disabled")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleToggle(upstream)}>
                          {upstream.enabled === 1 ? t("clients.disableAction") : t("clients.enableAction")}
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDelete(upstream.id)}>
                          {t("audit.delete")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
