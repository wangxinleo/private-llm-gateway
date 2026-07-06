"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OverflowBadges } from "@/components/overflow-badges";
import { useLocale } from "@/i18n";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { ShieldAlert, Eye, CheckCircle, Activity } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

function StatCard({ title, value, icon: Icon, color }: { title: string; value: number; icon: React.ComponentType<{ className?: string }>; color: string }) {
  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm transition-colors hover:border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className="font-mono text-3xl font-bold tabular-nums">{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}

interface AuditRow {
  id: number;
  timestamp: string;
  path: string;
  method: string;
  contentType: string;
  bodySize: number;
  filenames: string[];
  findings: string[];
  action: string;
}

interface Stats {
  total: number;
  blocked: number;
  masked: number;
  allowed: number;
}

export function DashboardContent() {
  const { t } = useLocale();
  const { authedFetch } = useAdminAuth();
  const [stats, setStats] = useState<Stats>({ total: 0, blocked: 0, masked: 0, allowed: 0 });
  const [recentBlocked, setRecentBlocked] = useState<AuditRow[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, blockRes, maskRes] = await Promise.all([
          authedFetch("/api/admin/stats"),
          authedFetch("/api/admin/audit?limit=10&action=block"),
          authedFetch("/api/admin/audit?limit=10&action=mask"),
        ]);
        if (statsRes.ok) setStats(await statsRes.json());

        // Merge block and mask records
        const blockRows = blockRes.ok ? (await blockRes.json()).rows ?? [] : [];
        const maskRows = maskRes.ok ? (await maskRes.json()).rows ?? [] : [];
        const combined = [...blockRows, ...maskRows];

        // Sort by id descending (newest first) and take top 10
        combined.sort((a, b) => b.id - a.id);
        setRecentBlocked(combined.slice(0, 10));
      } catch { /* DB may not exist yet */ }
    }
    load();
  }, [authedFetch]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-bold tracking-tight">{t("overview.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("overview.desc")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("overview.totalRequests")} value={stats.total} icon={Activity} color="text-muted-foreground" />
        <StatCard title={t("overview.blocked")} value={stats.blocked} icon={ShieldAlert} color="text-destructive" />
        <StatCard title={t("overview.masked")} value={stats.masked} icon={Eye} color="text-warning" />
        <StatCard title={t("overview.allowed")} value={stats.allowed} icon={CheckCircle} color="text-success" />
      </div>

      <Card className="overflow-hidden border-border/50">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="font-mono text-sm font-semibold tracking-wide">
            {t("overview.recentIncidents")}
          </CardTitle>
          <Link
            href="/dashboard/audit"
            className="shrink-0 text-xs font-medium text-primary hover:underline"
          >
            {t("overview.viewAll")}
          </Link>
        </CardHeader>
        <CardContent className="min-w-0">
          {recentBlocked.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("overview.noIncidents")}
            </p>
          ) : (
            <div className="min-w-0 divide-y divide-border/50">
              {recentBlocked.map((row) => (
                <div key={row.id} className="flex min-w-0 items-center gap-3 py-3">
                  <Badge variant={row.action === "block" ? "destructive" : "warning"} className="shrink-0 font-mono text-xs">
                    {t(`action.${row.action}`)}
                  </Badge>
                  <span className="shrink-0 font-mono text-sm text-muted-foreground">{row.method}</span>
                  <span className="min-w-0 flex-[2] truncate text-sm">{row.path}</span>
                  <OverflowBadges items={row.findings} className="min-w-0 flex-1" />
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {new Date(row.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
