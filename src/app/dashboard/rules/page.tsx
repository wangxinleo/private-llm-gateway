"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocale } from "@/i18n";
import { useAdminAuth } from "@/lib/admin-auth-context";

interface BypassRule {
  id: number;
  enabled: number;
  pathPrefix: string;
  modelName: string;
  startAt: string;
  endAt: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

interface RuleFormState {
  enabled: boolean;
  pathPrefix: string;
  modelName: string;
  startAt: string;
  endAt: string;
  note: string;
}

const EMPTY_FORM: RuleFormState = {
  enabled: true,
  pathPrefix: "/v1/chat",
  modelName: "",
  startAt: "",
  endAt: "",
  note: "",
};

function toIsoFromLocalDateTime(value: string): string {
  return new Date(value).toISOString();
}

function StatusBadge({ rule, t }: { rule: BypassRule; t: (key: string) => string }) {
  if (!rule.enabled) return <Badge variant="outline" className="font-mono text-xs">{t("rules.bypassStatus.disabled")}</Badge>;
  if (rule.isActive) return <Badge variant="success" className="font-mono text-xs">{t("rules.bypassStatus.active")}</Badge>;
  return <Badge variant="warning" className="font-mono text-xs">{t("rules.bypassStatus.scheduled")}</Badge>;
}

export default function RulesPage() {
  const { t, locale } = useLocale();
  const { authedFetch } = useAdminAuth();
  const [rules, setRules] = useState<BypassRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);

  const fmt = useMemo(
    () => (iso: string) => new Date(iso).toLocaleString(locale === "zh" ? "zh-CN" : "en-US"),
    [locale]
  );

  async function loadRules() {
    setLoading(true);
    setError("");
    try {
      const res = await authedFetch("/api/admin/bypass-rules");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRules(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      setError(t("rules.bypassLoadError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRules();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await authedFetch("/api/admin/bypass-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: form.enabled,
          pathPrefix: form.pathPrefix,
          modelName: form.modelName,
          startAt: toIsoFromLocalDateTime(form.startAt),
          endAt: toIsoFromLocalDateTime(form.endAt),
          note: form.note,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForm(EMPTY_FORM);
      await loadRules();
    } catch {
      setError(t("rules.bypassSaveError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(rule: BypassRule) {
    try {
      const res = await authedFetch(`/api/admin/bypass-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadRules();
    } catch {
      setError(t("rules.bypassSaveError"));
    }
  }

  async function handleDelete(ruleId: number) {
    try {
      const res = await authedFetch(`/api/admin/bypass-rules/${ruleId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadRules();
    } catch {
      setError(t("rules.bypassDeleteError"));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-bold tracking-tight">{t("rules.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("rules.desc")}</p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="font-mono text-sm tracking-wide">{t("rules.bypassCreateTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleCreate}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">{t("rules.bypassPathPrefix")}</span>
                <Input
                  value={form.pathPrefix}
                  onChange={(e) => setForm((prev) => ({ ...prev, pathPrefix: e.target.value }))}
                  placeholder="/v1/chat"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">{t("rules.bypassModel")}</span>
                <Input
                  value={form.modelName}
                  onChange={(e) => setForm((prev) => ({ ...prev, modelName: e.target.value }))}
                  placeholder="gpt-4o-mini"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">{t("rules.bypassStartAt")}</span>
                <Input
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => setForm((prev) => ({ ...prev, startAt: e.target.value }))}
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">{t("rules.bypassEndAt")}</span>
                <Input
                  type="datetime-local"
                  value={form.endAt}
                  onChange={(e) => setForm((prev) => ({ ...prev, endAt: e.target.value }))}
                />
              </label>
            </div>

            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">{t("rules.bypassNote")}</span>
              <Input
                value={form.note}
                onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                placeholder={t("rules.bypassNotePlaceholder")}
              />
            </label>

            <label className="flex items-center gap-3 text-sm">
              <Checkbox
                checked={form.enabled}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked === true }))}
              />
              <span className="text-muted-foreground">{t("rules.bypassEnabled")}</span>
            </label>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={submitting || !form.pathPrefix.trim() || !form.modelName.trim() || !form.startAt || !form.endAt}>
                {submitting ? t("rules.bypassSubmitting") : t("rules.bypassCreateAction")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("rules.bypassHint")}</p>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="font-mono text-sm tracking-wide">{t("rules.bypassListTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("audit.loading")}</p>
          ) : rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("rules.bypassEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("rules.bypassColStatus")}</TableHead>
                  <TableHead>{t("rules.bypassColPath")}</TableHead>
                  <TableHead>{t("rules.bypassColModel")}</TableHead>
                  <TableHead>{t("rules.bypassColWindow")}</TableHead>
                  <TableHead>{t("rules.bypassColNote")}</TableHead>
                  <TableHead>{t("rules.bypassColActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell><StatusBadge rule={rule} t={t} /></TableCell>
                    <TableCell><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{rule.pathPrefix}</code></TableCell>
                    <TableCell><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{rule.modelName}</code></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <div>{fmt(rule.startAt)}</div>
                      <div>{fmt(rule.endAt)}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{rule.note || "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleToggle(rule)}>
                          {rule.enabled ? t("rules.bypassDisableAction") : t("rules.bypassEnableAction")}
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDelete(rule.id)}>
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
