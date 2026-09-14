"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocale } from "@/i18n";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { getErrorText, isStringArrayConfigValue } from "@/lib/admin-config";
import { parseEnvContent, type ParsedEnvEntry } from "@/lib/env-import";
import type { AdminConfigResponse, EditableConfig, EditableConfigValue, FindingCategory } from "@/types";

const RULE_TOGGLE_CATEGORIES = [
  "PRIVATE_KEY", "BEARER_TOKEN", "BASIC_AUTH", "JWT", "COOKIE_HEADER", "SET_COOKIE_HEADER",
  "DB_URI", "AWS_ACCESS_KEY", "GITHUB_TOKEN", "DEVELOPER_TOKEN", "SLACK_TOKEN", "GOOGLE_API_KEY",
  "PROVIDER_API_KEY", "CLOUD_CREDENTIAL", "CONNECTION_STRING", "ENCODED_SECRET", "BASE64_TOKEN",
  "STRIPE_KEY", "SENDGRID_KEY", "CONTEXTUAL_SECRET", "SENSITIVE_FILENAME",
  "PHONE", "EMAIL", "ID_CARD", "BANK_CARD", "LANDLINE", "PLATE",
  "IP_PRIVATE", "IP_INTERNAL", "IBAN", "USCC", "MAC", "HKID", "CUSTOM_TERM",
] as FindingCategory[];

interface CustomWord {
  id: number;
  label: string;
  value: string;
  kind: "word" | "regex";
  whole_word: number;
  enabled: number;
  created_at: string;
}

function isValidRegex(value: string): boolean {
  try {
    new RegExp(value, "gu");
    return true;
  } catch {
    return false;
  }
}

const EMPTY_FORM = { label: "", value: "", kind: "word" as "word" | "regex", wholeWord: false };

export default function WordsPage() {
  const { t } = useLocale();
  const { authedFetch } = useAdminAuth();
  const [words, setWords] = useState<CustomWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);

  const [envOpen, setEnvOpen] = useState(false);
  const [envDraft, setEnvDraft] = useState("");
  const [envEntries, setEnvEntries] = useState<ParsedEnvEntry[]>([]);
  const [envLabel, setEnvLabel] = useState("ENV");

  // 规则开关与前缀管理(配置存 SQLite,热加载)
  const [editableConfigs, setEditableConfigs] = useState<Record<string, EditableConfig>>({});
  const [ruleToggles, setRuleToggles] = useState<Record<string, boolean>>({});
  const [secretPrefixes, setSecretPrefixes] = useState<string[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newSecretPrefix, setNewSecretPrefix] = useState("");

  const grouped = useMemo(() => {
    const map = new Map<string, CustomWord[]>();
    for (const word of words) {
      const list = map.get(word.label) ?? [];
      list.push(word);
      map.set(word.label, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [words]);

  async function loadWords() {
    setLoading(true);
    setError("");
    try {
      const res = await authedFetch("/api/admin/words");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWords(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      setError(t("words.loadError"));
    } finally {
      setLoading(false);
    }
  }

  async function loadConfig() {
    try {
      const res = await authedFetch("/api/admin/config");
      if (!res.ok) return;
      const data = await res.json() as AdminConfigResponse;
      if (!data.editableConfigs) return;
      setEditableConfigs(data.editableConfigs);
      const togglesValue = data.editableConfigs.rule_toggles?.value;
      const secretPrefixValue = data.editableConfigs.secret_prefixes?.value;
      setSecretPrefixes(isStringArrayConfigValue(secretPrefixValue) ? secretPrefixValue : []);
      if (togglesValue && typeof togglesValue === "object" && !Array.isArray(togglesValue)) {
        setRuleToggles(togglesValue as unknown as Record<string, boolean>);
      }
    } catch (err) {
      console.error("Failed to load config:", err);
    }
  }

  async function updateConfig(key: string, value: EditableConfigValue) {
    setUpdating(key);
    setError("");
    try {
      const res = await authedFetch("/api/admin/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(getErrorText(payload) ?? t("words.saveError"));
        return;
      }
      await loadConfig();
    } catch {
      setError(t("words.saveError"));
    } finally {
      setUpdating(null);
    }
  }

  async function toggleRule(category: string) {
    const next = { ...ruleToggles, [category]: !(ruleToggles[category] !== false) };
    setRuleToggles(next);
    await updateConfig("rule_toggles", next);
  }

  async function addSecretPrefix() {
    const trimmed = newSecretPrefix.trim();
    if (!trimmed) return;
    if (secretPrefixes.includes(trimmed)) {
      setNewSecretPrefix("");
      return;
    }
    await updateConfig("secret_prefixes", [...secretPrefixes, trimmed]);
    setNewSecretPrefix("");
  }

  async function removeSecretPrefix(index: number) {
    await updateConfig("secret_prefixes", secretPrefixes.filter((_, i) => i !== index));
  }

  function startEditConfig(key: string, currentValue: number) {
    setEditingConfig(key);
    setEditValue(String(currentValue));
  }

  async function saveEditConfig(key: string) {
    const numValue = Number(editValue);
    setEditingConfig(null);
    if (isNaN(numValue) || numValue < 0) {
      setError(t("words.saveError"));
      return;
    }
    await updateConfig(key, numValue);
  }

  useEffect(() => {
    loadWords();
    loadConfig();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (form.kind === "regex" && !isValidRegex(form.value)) {
      setError(t("words.invalidRegex"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await authedFetch("/api/admin/words", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error === "invalid_regex" ? t("words.invalidRegex") : t("words.saveError"));
        return;
      }
      setForm(EMPTY_FORM);
      await loadWords();
    } catch {
      setError(t("words.saveError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(word: CustomWord) {
    try {
      const res = await authedFetch("/api/admin/words", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: word.id, enabled: word.enabled !== 1 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadWords();
    } catch {
      setError(t("words.saveError"));
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await authedFetch(`/api/admin/words?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadWords();
    } catch {
      setError(t("words.deleteError"));
    }
  }

  function parseEnv() {
    setEnvEntries(parseEnvContent(envDraft));
  }

  async function importEnv() {
    const items = envEntries
      .filter((entry) => entry.selected)
      .map((entry) => ({
        label: envLabel.trim() || "ENV",
        value: entry.value,
        kind: "word",
        wholeWord: false,
      }));
    if (items.length === 0) return;
    setSubmitting(true);
    try {
      const res = await authedFetch("/api/admin/words", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEnvOpen(false);
      setEnvDraft("");
      setEnvEntries([]);
      await loadWords();
    } catch {
      setError(t("words.saveError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.ruleToggles")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("settings.ruleTogglesDesc")}</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {RULE_TOGGLE_CATEGORIES.map((category) => (
              <label key={category} className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2">
                <code className="font-mono text-xs">{category}</code>
                <Checkbox
                  checked={ruleToggles[category] !== false}
                  onCheckedChange={() => toggleRule(category)}
                  disabled={updating === "rule_toggles"}
                />
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.secretPrefixes")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("settings.secretPrefixesDesc")}</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {secretPrefixes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("settings.secretPrefixesEmpty")}</p>
            ) : (
              secretPrefixes.map((prefix, index) => (
                <div key={index} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                  <code className="font-mono text-sm">{prefix}</code>
                  <button
                    onClick={() => removeSecretPrefix(index)}
                    disabled={updating === "secret_prefixes"}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
            <div className="flex gap-2">
              <Input
                value={newSecretPrefix}
                onChange={(e) => setNewSecretPrefix(e.target.value)}
                placeholder={t("settings.secretPrefixPlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addSecretPrefix();
                }}
                disabled={updating === "secret_prefixes"}
              />
              <Button onClick={addSecretPrefix} disabled={updating === "secret_prefixes" || !newSecretPrefix.trim()}>
                {t("settings.addSecretPrefix")}
              </Button>
            </div>
            {(() => {
              const key = "secret_prefix_min_length";
              const config = editableConfigs[key];
              if (!config) return null;
              const isEditing = editingConfig === key;
              const value = typeof config.value === "number" ? config.value : 0;
              return (
                <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                  <span className="text-sm text-muted-foreground">{t("settings.secretPrefixMinLength")}</span>
                  {isEditing ? (
                    <Input
                      type="number"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEditConfig(key);
                        if (e.key === "Escape") setEditingConfig(null);
                      }}
                      onBlur={() => saveEditConfig(key)}
                      className="h-7 w-32 text-xs"
                      autoFocus
                    />
                  ) : (
                    <code
                      className="cursor-pointer rounded bg-muted px-2 py-0.5 font-mono text-xs hover:bg-muted/70"
                      onClick={() => startEditConfig(key, value)}
                    >
                      {value}
                    </code>
                  )}
                </div>
              );
            })()}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("words.createTitle")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("words.createDesc")}</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleCreate}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("words.label")}</span>
                <Input
                  value={form.label}
                  onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
                  placeholder={t("words.labelPlaceholder")}
                  maxLength={40}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("words.value")}</span>
                <Input
                  value={form.value}
                  onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
                  placeholder={t("words.valuePlaceholder")}
                  maxLength={200}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("words.kind")}</span>
                <select
                  value={form.kind}
                  onChange={(e) => setForm((prev) => ({ ...prev, kind: e.target.value as "word" | "regex" }))}
                  className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="word">{t("words.kindWord")}</option>
                  <option value="regex">{t("words.kindRegex")}</option>
                </select>
              </label>
              <label className="flex items-center gap-2.5 pt-6">
                <Checkbox
                  checked={form.wholeWord}
                  onCheckedChange={(checked) => setForm((prev) => ({ ...prev, wholeWord: checked === true }))}
                />
                <span className="text-xs text-muted-foreground">{t("words.wholeWord")}</span>
              </label>
            </div>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={submitting || !form.label.trim() || !form.value.trim()}>
                {submitting ? t("words.submitting") : t("words.createAction")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEnvOpen((open) => !open)}
              >
                {t("words.envImport")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("words.hint")}</p>
            </div>
          </form>

          {envOpen && (
            <div className="mt-4 space-y-3 rounded-md border border-dashed p-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{t("words.envLabel")}</span>
                  <Input value={envLabel} onChange={(e) => setEnvLabel(e.target.value)} className="h-9 w-40" maxLength={40} />
                </label>
                <Button type="button" size="sm" variant="outline" onClick={parseEnv} disabled={!envDraft.trim()}>
                  {t("words.envParse")}
                </Button>
              </div>
              <textarea
                value={envDraft}
                onChange={(e) => setEnvDraft(e.target.value)}
                placeholder={"OPENAI_API_KEY=sk-xxx\nDB_PASSWORD=\"p@ssw0rd\""}
                rows={6}
                className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {envEntries.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {t("words.envPreview").replace("{count}", String(envEntries.filter((e) => e.selected).length))}
                  </p>
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
                    {envEntries.map((entry, index) => (
                      <label key={`${entry.key}-${index}`} className="flex items-center gap-2.5 rounded px-2 py-1 hover:bg-muted/50">
                        <Checkbox
                          checked={entry.selected}
                          onCheckedChange={(checked) =>
                            setEnvEntries((prev) => prev.map((e, i) => (i === index ? { ...e, selected: checked === true } : e)))
                          }
                        />
                        <code className="font-mono text-xs text-muted-foreground">{entry.key}</code>
                        <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{entry.value}</code>
                      </label>
                    ))}
                  </div>
                  <Button type="button" size="sm" onClick={importEnv} disabled={submitting || envEntries.every((e) => !e.selected)}>
                    {t("words.envImportAction")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("words.listTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <div className="h-9 animate-pulse rounded-md bg-muted/50" />
              <div className="h-9 animate-pulse rounded-md bg-muted/40" />
            </div>
          ) : words.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center">
              <p className="text-sm font-medium text-foreground">{t("words.empty")}</p>
              <p className="mx-auto mt-1 max-w-[48ch] text-xs leading-5 text-muted-foreground">{t("words.emptyHint")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {grouped.map(([label, items]) => (
                <div key={label}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">{label}</Badge>
                    <span className="text-xs text-muted-foreground">{items.length}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("words.value")}</TableHead>
                        <TableHead>{t("words.kind")}</TableHead>
                        <TableHead>{t("words.wholeWord")}</TableHead>
                        <TableHead>{t("words.status")}</TableHead>
                        <TableHead>{t("words.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((word) => (
                        <TableRow key={word.id}>
                          <TableCell className="max-w-[320px] truncate">
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{word.value}</code>
                          </TableCell>
                          <TableCell>
                            <Badge variant={word.kind === "regex" ? "warning" : "outline"} className="font-mono text-xs">
                              {word.kind === "regex" ? t("words.kindRegex") : t("words.kindWord")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{word.whole_word === 1 ? "✓" : "—"}</TableCell>
                          <TableCell>
                            <Badge variant={word.enabled === 1 ? "success" : "outline"} className="font-mono text-xs">
                              {word.enabled === 1 ? t("words.enabled") : t("words.disabled")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm" onClick={() => handleToggle(word)}>
                                {word.enabled === 1 ? t("words.disableAction") : t("words.enableAction")}
                              </Button>
                              <Button variant="destructive" size="sm" onClick={() => handleDelete(word.id)}>
                                {t("audit.delete")}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
