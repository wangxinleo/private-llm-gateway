"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useLocale } from "@/i18n";
import { getErrorText, isHighRiskAssets, isStringArrayConfigValue } from "@/lib/admin-config";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { JsonEditor } from "@/components/json-editor";
import type { AdminConfigResponse, EditableConfig, EditableConfigValue, FindingCategory } from "@/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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

  // Secret prefixes state
  const [newSecretPrefix, setNewSecretPrefix] = useState("");
  const [secretPrefixes, setSecretPrefixes] = useState<string[]>([]);
  const [ruleToggles, setRuleToggles] = useState<Record<string, boolean>>({});

  // Editable number config state
  const [editingConfig, setEditingConfig] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // High-risk assets state
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
        const assetsValue = data.editableConfigs.high_risk_assets?.value;
        const togglesValue = data.editableConfigs.rule_toggles?.value;
        const secretPrefixValue = data.editableConfigs.secret_prefixes?.value;
        setPathPrefixes(isStringArrayConfigValue(prefixValue) ? prefixValue : []);
        setSecretPrefixes(isStringArrayConfigValue(secretPrefixValue) ? secretPrefixValue : []);
        if (togglesValue && typeof togglesValue === "object" && !Array.isArray(togglesValue)) {
          setRuleToggles(togglesValue as unknown as Record<string, boolean>);
        }
        setExclDraft(JSON.stringify(isHighRiskAssets(assetsValue) ? assetsValue : { domains: [], emails: [], accounts: [] }, null, 2));
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
    const newList = secretPrefixes.filter((_, i) => i !== index);
    await updateConfig("secret_prefixes", newList);
  }

  async function saveExclusionsDraft() {
    try {
      const parsed = JSON.parse(exclDraft) as unknown;
      if (!isHighRiskAssets(parsed)) throw new Error("invalid high-risk assets");
      await updateConfig("high_risk_assets", parsed);
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
    setEditValue(String(currentValue));
  }

  async function saveEditConfig(key: string) {
    const numValue = Number(editValue);
    if (isNaN(numValue) || numValue < 0) {
      setMessage({ type: "error", text: t("settings.configUpdateFailed") });
      setEditingConfig(null);
      setTimeout(() => setMessage(null), 3000);
      return;
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
      {message && (
        <div role="status" className={`fixed right-4 top-20 z-50 rounded-lg border px-4 py-2 text-sm shadow-lg md:top-[68px] ${message.type === "success" ? "border-success/30 bg-card text-success" : "border-destructive/30 bg-card text-destructive"}`}>
          {message.text}
        </div>
      )}

      {/* Path Prefix Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.pathPrefixConfig")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("settings.pathPrefixDesc")}</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {pathPrefixes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("settings.pathPrefixEmpty")}</p>
            ) : (
              pathPrefixes.map((prefix, index) => (
                <div key={index} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
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
      <Card>
        <CardHeader><CardTitle>{t("settings.envVars")}</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { key: "UPSTREAM_URL", value: runtimeEnv.upstreamUrl },
              { key: "DB_PATH", value: runtimeEnv.dbPath },
              { key: "DEBUG", value: String(runtimeEnv.debug) },
              { key: "NODE_ENV", value: runtimeEnv.nodeEnv },
              { key: "PORT", value: runtimeEnv.port },
            ].map(({ key, value }) => (
              <div key={key} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                <code className="font-mono text-xs text-primary">{key}</code>
                <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{value}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Context Key Configuration (Editable) */}
      <Card>
        <CardHeader><CardTitle>{t("settings.contextKeyConfig")}</CardTitle></CardHeader>
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
                <div key={key} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
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

      {/* Context Window Size (Editable) */}
      <Card>
        <CardHeader><CardTitle>{t("settings.contextWindowConfig")}</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { key: "context_window_size", label: "WINDOW_SIZE" },
            ].map(({ key, label }) => {
              const config = editableConfigs[key];
              if (!config) return null;
              const isEditing = editingConfig === key;
              const value = typeof config.value === "number" ? config.value : 0;

              return (
                <div key={key} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                  <code className="font-mono text-xs text-primary">CONTEXT_WINDOW.{label}</code>
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

      {/* High-risk assets */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.highRiskAssets")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("settings.highRiskAssetsDesc")}</p>
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
                  disabled={updating === "high_risk_assets"}
                >
                  {t("settings.exclusionSave")}
                </Button>
                <Button
                  variant="outline"
                  onClick={cancelExclEdit}
                  disabled={updating === "high_risk_assets"}
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

      {/* Builtin rule toggles */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.ruleToggles")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("settings.ruleTogglesDesc")}</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                "PRIVATE_KEY", "BEARER_TOKEN", "BASIC_AUTH", "JWT", "COOKIE_HEADER", "SET_COOKIE_HEADER",
                "DB_URI", "AWS_ACCESS_KEY", "GITHUB_TOKEN", "DEVELOPER_TOKEN", "SLACK_TOKEN", "GOOGLE_API_KEY",
                "PROVIDER_API_KEY", "CLOUD_CREDENTIAL", "CONNECTION_STRING", "ENCODED_SECRET", "BASE64_TOKEN",
                "STRIPE_KEY", "SENDGRID_KEY", "CONTEXTUAL_SECRET", "SENSITIVE_FILENAME",
                "PHONE", "EMAIL", "ID_CARD", "BANK_CARD", "LANDLINE", "PLATE",
                "IP_PRIVATE", "IP_INTERNAL", "IBAN", "USCC", "MAC", "HKID", "CUSTOM_TERM",
              ] as FindingCategory[]
            ).map((category) => (
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

      {/* Secret prefixes */}
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
          </div>
        </CardContent>
      </Card>

      {/* Engine behavior */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.engineBehavior")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("settings.engineBehaviorDesc")}</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { key: "log_retention_days", label: t("settings.logRetentionDays") },
              { key: "max_body_mb", label: t("settings.maxBodyMb") },
              { key: "secret_prefix_min_length", label: t("settings.secretPrefixMinLength") },
            ].map(({ key, label }) => {
              const config = editableConfigs[key];
              if (!config) return null;
              const isEditing = editingConfig === key;
              const value = typeof config.value === "number" ? config.value : 0;

              return (
                <div key={key} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  {isEditing ? (
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
            {(["audit_severity_floor", "fail_closed"] as const).map((key) => {
              const config = editableConfigs[key];
              if (!config) return null;
              const value = String(config.value);
              return (
                <div key={key} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                  <span className="text-sm text-muted-foreground">
                    {key === "audit_severity_floor" ? t("settings.severityFloor") : t("settings.failClosed")}
                  </span>
                  {key === "audit_severity_floor" ? (
                    <select
                      value={value}
                      onChange={(e) => updateConfig(key, e.target.value)}
                      disabled={updating === key}
                      className="h-7 rounded-md border border-border bg-transparent px-2 font-mono text-xs"
                    >
                      {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <label className="flex cursor-pointer items-center gap-2">
                      <Checkbox
                        checked={value === "1"}
                        onCheckedChange={() => updateConfig(key, value === "1" ? "0" : "1")}
                        disabled={updating === key}
                      />
                      <code className="font-mono text-xs">{value === "1" ? "ON" : "OFF"}</code>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Database Statistics (Read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t("settings.dbStats")}
            <Badge variant="outline" className="font-mono">{formatBytes(dbStats.dbFileSize)}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
              <span className="text-sm text-muted-foreground">{t("settings.totalRecords")}</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs tabular-nums">{dbStats.totalRecords.toLocaleString()}</code>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
              <span className="text-sm text-muted-foreground">{t("settings.earliestRecord")}</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{fmt(dbStats.earliestRecord)}</code>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
              <span className="text-sm text-muted-foreground">{t("settings.latestRecord")}</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{fmt(dbStats.latestRecord)}</code>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
              <span className="text-sm text-muted-foreground">{t("settings.dbFileSize")}</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{formatBytes(dbStats.dbFileSize)}</code>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
