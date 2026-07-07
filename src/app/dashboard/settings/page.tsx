"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n";
import { getErrorText, isExclusionRuleArray, isStringArrayConfigValue } from "@/lib/admin-config";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { JsonEditor } from "@/components/json-editor";
import type { AdminConfigResponse, EditableConfig, EditableConfigValue } from "@/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function parseBytes(input: string): number | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();

  switch (unit) {
    case 'B': return value;
    case 'KB': return value * 1024;
    case 'MB': return value * 1024 * 1024;
    case 'GB': return value * 1024 * 1024 * 1024;
    default: return null;
  }
}

interface DbStats {
  totalRecords: number;
  earliestRecord: string | null;
  latestRecord: string | null;
  dbFileSize: number;
}

interface RuntimeEnv {
  upstreamUrl: string;
  dbPath: string;
  debug: boolean;
  nodeEnv: string;
  port: string;
}

export default function SettingsPage() {
  const { t, locale } = useLocale();
  const { authedFetch } = useAdminAuth();
  const [dbStats, setDbStats] = useState<DbStats>({
    totalRecords: 0,
    earliestRecord: null,
    latestRecord: null,
    dbFileSize: 0,
  });
  const [runtimeEnv, setRuntimeEnv] = useState<RuntimeEnv>({
    upstreamUrl: "—",
    dbPath: "—",
    debug: false,
    nodeEnv: "—",
    port: "—",
  });
  const [editableConfigs, setEditableConfigs] = useState<Record<string, EditableConfig>>({});
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Path prefix state
  const [newPathPrefix, setNewPathPrefix] = useState("");
  const [pathPrefixes, setPathPrefixes] = useState<string[]>([]);

  // Editable number config state
  const [editingConfig, setEditingConfig] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Scanner exclusions state
  const [exclDraft, setExclDraft] = useState("");
  const [exclEditing, setExclEditing] = useState(false);

  useEffect(() => {
    loadConfig();
  }, [authedFetch]);

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await authedFetch("/api/admin/config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as AdminConfigResponse;

      if (data.dbStats) setDbStats(data.dbStats);
      if (data.env) setRuntimeEnv(data.env);
      if (data.editableConfigs) {
        setEditableConfigs(data.editableConfigs);
        const prefixValue = data.editableConfigs.path_prefix_options?.value;
        const exclusionValue = data.editableConfigs.scanner_exclusions?.value;
        setPathPrefixes(isStringArrayConfigValue(prefixValue) ? prefixValue : []);
        setExclDraft(JSON.stringify(isExclusionRuleArray(exclusionValue) ? exclusionValue : [], null, 2));
      }
    } catch (err) {
      console.error("Failed to load config:", err);
    } finally {
      setLoading(false);
    }
  }

  async function updateConfig(key: string, value: EditableConfigValue) {
    setUpdating(key);
    setMessage(null);
    try {
      const res = await authedFetch("/api/admin/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value }),
      });

      if (!res.ok) {
        const error = await res.json() as unknown;
        setMessage({ type: "error", text: getErrorText(error) ?? t("settings.configUpdateFailed") });
        setTimeout(() => setMessage(null), 3000);
        return;
      }

      setMessage({ type: "success", text: t("settings.configUpdateSuccess") });
      await loadConfig();
    } catch (err) {
      setMessage({ type: "error", text: t("settings.configUpdateFailed") });
      console.error("Failed to update config:", err);
    } finally {
      setUpdating(null);
      setTimeout(() => setMessage(null), 3000);
    }
  }

  async function addPathPrefix() {
    const trimmed = newPathPrefix.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("/")) {
      setMessage({ type: "error", text: t("settings.pathPrefixInvalid") });
      setTimeout(() => setMessage(null), 3000);
      return;
    }

    const newList = [...pathPrefixes, trimmed];
    await updateConfig("path_prefix_options", newList);
    setNewPathPrefix("");
  }

  async function removePathPrefix(index: number) {
    const newList = pathPrefixes.filter((_, i) => i !== index);
    await updateConfig("path_prefix_options", newList);
  }

  async function saveExclusionsDraft() {
    try {
      const parsed = JSON.parse(exclDraft) as unknown;
      if (!isExclusionRuleArray(parsed)) throw new Error("invalid exclusion rules");
      await updateConfig("scanner_exclusions", parsed);
      setExclEditing(false);
    } catch {
      setMessage({ type: "error", text: t("settings.configUpdateFailed") });
      setTimeout(() => setMessage(null), 3000);
    }
  }

  function cancelExclEdit() {
    setExclEditing(false);
  }

  function startEditConfig(key: string, currentValue: number) {
    setEditingConfig(key);
    // For size configs, show formatted value with unit (e.g., "128 KB")
    if (key.includes('size') || key.includes('threshold')) {
      setEditValue(formatBytes(currentValue));
    } else {
      setEditValue(String(currentValue));
    }
  }

  async function saveEditConfig(key: string) {
    let numValue: number;

    // For size configs, parse unit-aware input (e.g., "128 KB", "1 MB")
    if (key.includes('size') || key.includes('threshold')) {
      const parsed = parseBytes(editValue);
      if (parsed === null || parsed < 0) {
        setMessage({ type: "error", text: t("settings.configUpdateFailed") });
        setEditingConfig(null);
        setTimeout(() => setMessage(null), 3000);
        return;
      }
      numValue = parsed;
    } else {
      numValue = Number(editValue);
      if (isNaN(numValue) || numValue < 0) {
        setMessage({ type: "error", text: t("settings.configUpdateFailed") });
        setEditingConfig(null);
        setTimeout(() => setMessage(null), 3000);
        return;
      }
    }

    await updateConfig(key, numValue);
    setEditingConfig(null);
  }

  function cancelEdit() {
    setEditingConfig(null);
    setEditValue("");
  }

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString(locale === "zh" ? "zh-CN" : "en-US") : "—";

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold leading-tight tracking-[-0.035em]">{t("settings.title")}</h1>
          <p className="mt-1 max-w-[65ch] text-sm leading-6 text-muted-foreground">{t("settings.desc")}</p>
        </div>
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="h-4 w-48 animate-pulse rounded bg-muted/60" />
            <div className="h-10 animate-pulse rounded-md bg-muted/40" />
            <div className="h-10 animate-pulse rounded-md bg-muted/30" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold leading-tight tracking-[-0.035em]">{t("settings.title")}</h1>
        <p className="mt-1 max-w-[65ch] text-sm leading-6 text-muted-foreground">{t("settings.desc")}</p>
      </div>

      {message && (
        <div role="status" className={`fixed right-4 top-20 z-50 rounded-lg border px-4 py-2 text-sm shadow-[0_18px_50px_oklch(0.07_0.02_175/0.32)] backdrop-blur-xl md:top-4 ${message.type === "success" ? "border-success/35 bg-success/12 text-success" : "border-destructive/35 bg-destructive/12 text-destructive"}`}>
          {message.text}
        </div>
      )}

      {/* Path Prefix Configuration */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="font-mono text-sm tracking-wide">{t("settings.pathPrefixConfig")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("settings.pathPrefixDesc")}</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {pathPrefixes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("settings.pathPrefixEmpty")}</p>
            ) : (
              pathPrefixes.map((prefix, index) => (
                <div key={index} className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
                  <code className="font-mono text-sm">{prefix}</code>
                  <button
                    onClick={() => removePathPrefix(index)}
                    disabled={updating === "path_prefix_options"}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
            <div className="flex gap-2">
              <Input
                value={newPathPrefix}
                onChange={(e) => setNewPathPrefix(e.target.value)}
                placeholder={t("settings.pathPrefixPlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addPathPrefix();
                }}
                disabled={updating === "path_prefix_options"}
              />
              <Button onClick={addPathPrefix} disabled={updating === "path_prefix_options" || !newPathPrefix.trim()}>
                {t("settings.addPathPrefix")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Environment Variables (Read-only) */}
      <Card className="border-border/50">
        <CardHeader><CardTitle className="font-mono text-sm tracking-wide">{t("settings.envVars")}</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { key: "UPSTREAM_URL", value: runtimeEnv.upstreamUrl },
              { key: "DB_PATH", value: runtimeEnv.dbPath },
              { key: "DEBUG", value: String(runtimeEnv.debug) },
              { key: "NODE_ENV", value: runtimeEnv.nodeEnv },
              { key: "PORT", value: runtimeEnv.port },
            ].map(({ key, value }) => (
              <div key={key} className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
                <code className="font-mono text-xs text-primary">{key}</code>
                <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{value}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Scanner Thresholds (Editable) */}
      <Card className="border-border/50">
        <CardHeader><CardTitle className="font-mono text-sm tracking-wide">{t("settings.scannerThresholds")}</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { key: "size_threshold_full_scan", label: "FULL_SCAN", desc: t("settings.fullScanDesc") },
              { key: "size_threshold_chunked_scan", label: "CHUNKED_SCAN", desc: t("settings.chunkedScanDesc") },
              { key: "chunk_size", label: "CHUNK_SIZE", desc: t("settings.chunkSizeDesc") },
            ].map(({ key, label, desc }) => {
              const config = editableConfigs[key];
              if (!config) return null;
              const isEditing = editingConfig === key;
              const value = typeof config.value === "number" ? config.value : 0;

              return (
                <div key={key} className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
                  <div>
                    <code className="font-mono text-xs text-primary">{label}</code>
                    <span className="ml-2 text-xs text-muted-foreground">{desc}</span>
                  </div>
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEditConfig(key);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        onBlur={() => saveEditConfig(key)}
                        className="h-7 w-40 text-xs"
                        autoFocus
                        placeholder="e.g., 128 KB, 1 MB"
                      />
                    </div>
                  ) : (
                    <code
                      className="cursor-pointer rounded bg-muted px-2 py-0.5 font-mono text-xs hover:bg-muted/70"
                      onClick={() => startEditConfig(key, value)}
                    >
                      {formatBytes(value)}
                    </code>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Context Key Configuration (Editable) */}
      <Card className="border-border/50">
        <CardHeader><CardTitle className="font-mono text-sm tracking-wide">{t("settings.contextKeyConfig")}</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { key: "context_key_min_length", label: "MIN_LENGTH" },
              { key: "context_key_max_length", label: "MAX_LENGTH" },
              { key: "context_key_max_spaces", label: "MAX_SPACES" },
            ].map(({ key, label }) => {
              const config = editableConfigs[key];
              if (!config) return null;
              const isEditing = editingConfig === key;
              const value = typeof config.value === "number" ? config.value : 0;

              return (
                <div key={key} className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
                  <code className="font-mono text-xs text-primary">CONTEXT_KEY.{label}</code>
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEditConfig(key);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        onBlur={() => saveEditConfig(key)}
                        className="h-7 w-32 text-xs"
                        autoFocus
                      />
                    </div>
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
            })}
          </div>
        </CardContent>
      </Card>

      {/* Scanner Exclusion Rules */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="font-mono text-sm tracking-wide">{t("settings.scannerExclusions")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("settings.scannerExclusionsDesc")}</p>
        </CardHeader>
        <CardContent>
          {exclEditing ? (
            <div className="space-y-3">
              <JsonEditor
                value={exclDraft}
                onChange={setExclDraft}
                minHeight={240}
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  onClick={saveExclusionsDraft}
                  disabled={updating === "scanner_exclusions"}
                >
                  {t("settings.exclusionSave")}
                </Button>
                <Button
                  variant="outline"
                  onClick={cancelExclEdit}
                  disabled={updating === "scanner_exclusions"}
                >
                  {t("settings.exclusionCancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <JsonEditor
                value={exclDraft}
                onChange={() => {}}
                readOnly
                placeholder={t("settings.exclusionEmpty")}
                minHeight={60}
              />
              <Button
                variant="outline"
                onClick={() => setExclEditing(true)}
              >
                {t("settings.exclusionEdit")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Database Statistics (Read-only) */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-sm tracking-wide">
            {t("settings.dbStats")}
            <Badge variant="outline" className="font-mono text-xs">{formatBytes(dbStats.dbFileSize)}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
              <span className="text-sm text-muted-foreground">{t("settings.totalRecords")}</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs tabular-nums">{dbStats.totalRecords.toLocaleString()}</code>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
              <span className="text-sm text-muted-foreground">{t("settings.earliestRecord")}</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{fmt(dbStats.earliestRecord)}</code>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
              <span className="text-sm text-muted-foreground">{t("settings.latestRecord")}</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{fmt(dbStats.latestRecord)}</code>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
              <span className="text-sm text-muted-foreground">{t("settings.dbFileSize")}</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{formatBytes(dbStats.dbFileSize)}</code>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
