"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/i18n";
import { UPSTREAM_URL, DB_PATH, DEBUG, SIZE_THRESHOLDS, CHUNK_SIZE, CONTEXT_KEY } from "@/config";
import { useEffect, useState } from "react";

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

export default function SettingsPage() {
  const { t, locale } = useLocale();
  const [dbStats, setDbStats] = useState<DbStats>({
    totalRecords: 0,
    earliestRecord: null,
    latestRecord: null,
    dbFileSize: 0,
  });

  useEffect(() => {
    fetch("/api/admin/config")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.dbStats) {
          setDbStats({
            totalRecords: data.dbStats.totalRecords ?? 0,
            earliestRecord: data.dbStats.earliestRecord ?? null,
            latestRecord: data.dbStats.latestRecord ?? null,
            dbFileSize: data.dbStats.dbFileSize ?? 0,
          });
        }
      })
      .catch(() => {});
  }, []);

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString(locale === "zh" ? "zh-CN" : "en-US") : "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.desc")}</p>
      </div>

      <Card className="border-border/50">
        <CardHeader><CardTitle className="font-mono text-sm tracking-wide">{t("settings.envVars")}</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { key: "UPSTREAM_URL", value: UPSTREAM_URL },
              { key: "DB_PATH", value: DB_PATH },
              { key: "DEBUG", value: String(DEBUG) },
              { key: "NODE_ENV", value: process.env.NODE_ENV ?? "development" },
              { key: "PORT", value: process.env.PORT ?? "3000" },
            ].map(({ key, value }) => (
              <div key={key} className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
                <code className="font-mono text-xs text-primary">{key}</code>
                <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{value}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader><CardTitle className="font-mono text-sm tracking-wide">{t("settings.scannerThresholds")}</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { key: "FULL_SCAN", value: formatBytes(SIZE_THRESHOLDS.FULL_SCAN), desc: t("settings.fullScanDesc") },
              { key: "CHUNKED_SCAN", value: formatBytes(SIZE_THRESHOLDS.CHUNKED_SCAN), desc: t("settings.chunkedScanDesc") },
              { key: "CHUNK_SIZE", value: formatBytes(CHUNK_SIZE), desc: t("settings.chunkSizeDesc") },
            ].map(({ key, value, desc }) => (
              <div key={key} className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
                <div><code className="font-mono text-xs text-primary">{key}</code><span className="ml-2 text-xs text-muted-foreground">{desc}</span></div>
                <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{value}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader><CardTitle className="font-mono text-sm tracking-wide">{t("settings.contextKeyConfig")}</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { key: "MIN_LENGTH", value: String(CONTEXT_KEY.MIN_LENGTH) },
              { key: "MAX_LENGTH", value: String(CONTEXT_KEY.MAX_LENGTH) },
              { key: "MAX_SPACES", value: String(CONTEXT_KEY.MAX_SPACES) },
            ].map(({ key, value }) => (
              <div key={key} className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
                <code className="font-mono text-xs text-primary">CONTEXT_KEY.{key}</code>
                <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{value}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-sm tracking-wide">
            {t("settings.dbStats")}
            <Badge variant="outline" className="font-mono text-[10px]">{formatBytes(dbStats.dbFileSize)}</Badge>
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
