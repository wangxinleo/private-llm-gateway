"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocale } from "@/i18n";
import { isStringArrayConfigValue } from "@/lib/admin-config";
import { useAdminAuth } from "@/lib/admin-auth-context";
import type { AdminConfigResponse } from "@/types";

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
  duration: number; // hours
  note: string;
}

const EMPTY_FORM: RuleFormState = {
  enabled: true,
  pathPrefix: "/api/v1/messages",
  modelName: "",
  duration: 4,
  note: "",
};

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
  const [pathPrefixOptions, setPathPrefixOptions] = useState<string[]>([]);

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

  async function loadPathPrefixOptions() {
    try {
      const res = await authedFetch("/api/admin/config");
      if (!res.ok) return;
      const data = await res.json() as AdminConfigResponse;
      const options = data.editableConfigs?.path_prefix_options?.value;
      if (isStringArrayConfigValue(options)) {
        setPathPrefixOptions(options);
        // Set first option as default if form is still empty
        if (options.length > 0 && !form.pathPrefix) {
          setForm((prev) => ({ ...prev, pathPrefix: options[0] }));
        }
      }
    } catch (err) {
      console.error("Failed to load path prefix options:", err);
    }
  }

  useEffect(() => {
    loadRules();
    loadPathPrefixOptions();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const now = new Date();
      const startAt = now.toISOString();
      const endAt = new Date(now.getTime() + form.duration * 3600000).toISOString();

      const res = await authedFetch("/api/admin/bypass-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: form.enabled,
          pathPrefix: form.pathPrefix,
          modelName: form.modelName,
          startAt,
          endAt,
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

  async function handleReactivate(rule: BypassRule) {
    try {
      const res = await authedFetch(`/api/admin/bypass-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reactivate: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadRules();
    } catch {
      setError(t("rules.bypassReactivateError"));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold leading-tight tracking-[-0.035em]">{t("rules.title")}</h1>
        <p className="mt-1 max-w-[65ch] text-sm leading-6 text-muted-foreground">{t("rules.desc")}</p>
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
                <select
                  value={form.pathPrefix}
                  onChange={(e) => setForm((prev) => ({ ...prev, pathPrefix: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {pathPrefixOptions.length === 0 ? (
                    <option value="">No options configured</option>
                  ) : (
                    pathPrefixOptions.map((prefix) => (
                      <option key={prefix} value={prefix}>{prefix}</option>
                    ))
                  )}
                </select>
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
                <span className="text-muted-foreground">{t("rules.bypassDuration")}</span>
                <select
                  value={form.duration}
                  onChange={(e) => setForm((prev) => ({ ...prev, duration: Number(e.target.value) }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value={4}>{t("rules.bypassDuration4h")}</option>
                  <option value={8}>{t("rules.bypassDuration8h")}</option>
                  <option value={24}>{t("rules.bypassDuration1d")}</option>
                </select>
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
              <Button type="submit" disabled={submitting || !form.pathPrefix.trim() || !form.modelName.trim()}>
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
            <div className="space-y-3">
              <div className="h-9 animate-pulse rounded-md bg-muted/50" />
              <div className="h-9 animate-pulse rounded-md bg-muted/40" />
              <div className="h-9 animate-pulse rounded-md bg-muted/30" />
            </div>
          ) : rules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-8 text-center">
              <p className="text-sm font-medium text-foreground">{t("rules.bypassEmpty")}</p>
              <p className="mx-auto mt-1 max-w-[48ch] text-xs leading-5 text-muted-foreground">{t("rules.bypassEmptyHint")}</p>
            </div>
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
                        {rule.enabled && !rule.isActive && new Date(rule.endAt).getTime() < Date.now() ? (
                          <Button variant="outline" size="sm" onClick={() => handleReactivate(rule)}>
                            {t("rules.bypassReactivateAction")}
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => handleToggle(rule)}>
                            {rule.enabled ? t("rules.bypassDisableAction") : t("rules.bypassEnableAction")}
                          </Button>
                        )}
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
