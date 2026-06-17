"use client";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useLocale } from "@/i18n";
import { useAdminAuth } from "@/lib/admin-auth-context";
import {
  Trash2,
  Download,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  X,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

type FindingCategory = string;
type ActionType = "allow" | "mask" | "block";
type TimeRangePreset = "today" | "last3days" | "thisWeek" | "thisMonth" | "last3months" | "last6months";

interface AuditRow {
  id: number;
  timestamp: string;
  path: string;
  method: string;
  contentType: string;
  bodySize: number;
  filenames: string[];
  findings: FindingCategory[];
  action: ActionType;
}

interface AuditResponse {
  rows: AuditRow[];
  total: number;
  page: number;
  limit: number;
}

const FINDING_CATEGORIES: FindingCategory[] = [
  "PRIVATE_KEY", "BEARER_TOKEN", "BASIC_AUTH", "JWT",
  "COOKIE_HEADER", "SET_COOKIE_HEADER", "DB_URI",
  "AWS_ACCESS_KEY", "GITHUB_TOKEN", "SLACK_TOKEN", "GOOGLE_API_KEY",
  "CONTEXTUAL_SECRET", "SENSITIVE_FILENAME",
  "PHONE", "EMAIL", "ID_CARD", "BANK_CARD",
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ActionBadge({ action, label }: { action: ActionType; label: string }) {
  const variant = action === "block" ? "destructive" : action === "mask" ? "warning" : "success";
  return <Badge variant={variant} className="font-mono text-xs">{label}</Badge>;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date): Date {
  const next = startOfDay(date);
  const day = next.getDay();
  const diff = day === 0 ? 6 : day - 1;
  next.setDate(next.getDate() - diff);
  return next;
}

function startOfMonth(date: Date): Date {
  const next = startOfDay(date);
  next.setDate(1);
  return next;
}

function subtractDays(date: Date, days: number): Date {
  const next = startOfDay(date);
  next.setDate(next.getDate() - days);
  return next;
}

function subtractMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() - months);
  return startOfDay(next);
}

function getTimeRangeBounds(range: TimeRangePreset): { from: Date; to: Date } {
  const now = new Date();
  switch (range) {
    case "today":
      return { from: startOfDay(now), to: now };
    case "last3days":
      return { from: subtractDays(now, 2), to: now };
    case "thisWeek":
      return { from: startOfWeek(now), to: now };
    case "thisMonth":
      return { from: startOfMonth(now), to: now };
    case "last3months":
      return { from: subtractMonths(now, 3), to: now };
    case "last6months":
      return { from: subtractMonths(now, 6), to: now };
  }
}

export function AuditTable() {
  const { t, locale } = useLocale();
  const { adminKey, authedFetch } = useAdminAuth();
  const [data, setData] = useState<AuditResponse>({ rows: [], total: 0, page: 1, limit: 50 });
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    title: string;
    desc: string;
    onConfirm: () => void;
  }>({ open: false, title: "", desc: "", onConfirm: () => {} });
  const [cleanDialog, setCleanDialog] = useState<{
    open: boolean;
    count: number | null;
    before: string;
    action: string;
  }>({ open: false, count: null, before: "", action: "allow" });

  const [action, setAction] = useState("");
  const [method, setMethod] = useState("");
  const [finding, setFinding] = useState("");
  const [query, setQuery] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRangePreset>("today");
  const [sseConnected, setSseConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const filtersRef = useRef({ action, method, finding, query, timeRange, page: data.page });
  filtersRef.current = { action, method, finding, query, timeRange, page: data.page };

  const ACTION_OPTIONS = [
    { value: "", label: t("audit.filter.allActions") },
    { value: "allow", label: t("action.allow") },
    { value: "mask", label: t("action.mask") },
    { value: "block", label: t("action.block") },
  ];

  const METHOD_OPTIONS = [
    { value: "", label: t("audit.filter.allMethods") },
    { value: "GET", label: "GET" },
    { value: "POST", label: "POST" },
    { value: "PUT", label: "PUT" },
    { value: "PATCH", label: "PATCH" },
    { value: "DELETE", label: "DELETE" },
  ];

  const PATH_OPTIONS = [
    { value: "", label: t("audit.filter.allPaths") },
    { value: "/api/v1/messages", label: "/api/v1/messages" },
    { value: "/api/v1/responses", label: "/api/v1/responses" },
    { value: "/api/v1beta", label: "/api/v1beta" },
  ];

  const TIME_RANGE_OPTIONS: { value: TimeRangePreset; label: string }[] = [
    { value: "today", label: t("audit.filter.range.today") },
    { value: "last3days", label: t("audit.filter.range.last3days") },
    { value: "thisWeek", label: t("audit.filter.range.thisWeek") },
    { value: "thisMonth", label: t("audit.filter.range.thisMonth") },
    { value: "last3months", label: t("audit.filter.range.last3months") },
    { value: "last6months", label: t("audit.filter.range.last6months") },
  ];

  const buildUrl = useCallback(
    (page: number) => {
      const params = new URLSearchParams();
      const { from, to } = getTimeRangeBounds(timeRange);
      params.set("page", String(page));
      params.set("limit", "50");
      if (action) params.set("action", action);
      if (method) params.set("method", method);
      if (finding) params.set("finding", finding);
      if (query) params.set("q", query);
      params.set("from", from.toISOString());
      params.set("to", to.toISOString());
      return `/api/admin/audit?${params.toString()}`;
    },
    [action, method, finding, query, timeRange]
  );

  const fetchData = useCallback(
    async (page: number) => {
      setLoading(true);
      try {
        const res = await authedFetch(buildUrl(page));
        if (res.ok) {
          const json: AuditResponse = await res.json();
          setData(json);
        }
      } finally {
        setLoading(false);
      }
    },
    [buildUrl, authedFetch]
  );

  useEffect(() => { fetchData(1); }, [fetchData]);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const setupEventSource = () => {
      const sseUrl = adminKey
        ? `/api/admin/audit/stream?key=${encodeURIComponent(adminKey)}`
        : "/api/admin/audit/stream";
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;
      es.onopen = () => setSseConnected(true);
      es.onerror = () => {
        setSseConnected(false);
        es.close();
        reconnectTimer = setTimeout(setupEventSource, 5000);
      };
      es.addEventListener("audit", (e: MessageEvent) => {
        try {
          const row: AuditRow = JSON.parse(e.data);
          const f = filtersRef.current;
          const hasFilters = f.action || f.method || f.finding || f.query || f.timeRange !== "today";
          if (f.page !== 1 || hasFilters) return;
          setData((prev) => ({ ...prev, rows: [row, ...prev.rows].slice(0, prev.limit), total: prev.total + 1 }));
        } catch { /* ignore */ }
      });
    };

    setupEventSource();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      eventSourceRef.current?.close();
    };
  }, []);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleSelectAll = () => {
    setSelectedIds(data.rows.length > 0 && selectedIds.size === data.rows.length ? new Set() : new Set(data.rows.map((r) => r.id)));
  };

  const handleDeleteByIds = async (ids: number[]) => {
    setDeleteDialog({
      open: true,
      title: t("audit.confirmDeletion"),
      desc: t("audit.confirmDeleteDesc", { count: ids.length }),
      onConfirm: async () => {
        await authedFetch("/api/admin/audit", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
        setSelectedIds(new Set());
        fetchData(data.page);
        setDeleteDialog((d) => ({ ...d, open: false }));
      },
    });
  };

  const handleDeleteSingle = (id: number) => handleDeleteByIds([id]);

  const handleCleanByFilter = async (before: string, act: string) => {
    const filter: { before: string; action?: string } = { before };
    if (act) filter.action = act as ActionType;
    const dryRes = await authedFetch("/api/admin/audit?dryRun=true", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filter }) });
    const dryData = await dryRes.json();
    setCleanDialog({ open: true, count: dryData.wouldDelete ?? 0, before, action: act });
  };

  const confirmClean = async () => {
    const filter: { before: string; action?: string } = { before: cleanDialog.before };
    if (cleanDialog.action) filter.action = cleanDialog.action as ActionType;
    await authedFetch("/api/admin/audit", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filter }) });
    setCleanDialog((d) => ({ ...d, open: false }));
    fetchData(1);
  };

  const handleExportCsv = () => {
    const header = "Time,Method,Path,Content-Type,Size,Findings,Action";
    const rows = data.rows.map((r) => [r.timestamp, r.method, `"${r.path}"`, r.contentType, r.bodySize, r.findings.join(";"), r.action].join(","));
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(data.total / data.limit);
  const hasFilters = action || method || finding || query || timeRange !== "today";

  const formatTime = (iso: string) => new Date(iso).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("audit.filter.action")}</label>
          <select value={action} onChange={(e) => setAction(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            {ACTION_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("audit.filter.method")}</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            {METHOD_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("audit.filter.finding")}</label>
          <select value={finding} onChange={(e) => setFinding(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">{t("audit.filter.allCategories")}</option>
            {FINDING_CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("audit.filter.path")}</label>
          <select value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            {PATH_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("audit.filter.timeRange")}</label>
          <select value={timeRange} onChange={(e) => setTimeRange(e.target.value as TimeRangePreset)} className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            {TIME_RANGE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-9 shrink-0 self-end px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => { setAction(""); setMethod(""); setFinding(""); setQuery(""); setTimeRange("today"); }}>
            <X className="mr-1 h-3 w-3" />{t("audit.filter.clear")}
          </Button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 && (
            <>
              <span className="font-mono text-xs text-muted-foreground">{selectedIds.size} {t("audit.selected")}</span>
              <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => handleDeleteByIds(Array.from(selectedIds))}>
                <Trash2 className="mr-1 h-3 w-3" />{t("audit.deleteSelected")}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setSelectedIds(new Set())}>
                {t("audit.clearSelection")}
              </Button>
              <Separator orientation="vertical" className="h-5" />
            </>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleCleanByFilter(new Date(Date.now() - 30 * 86400000).toISOString(), "allow")}>
            <Clock className="mr-1 h-3 w-3" />{t("audit.clean30d")}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleCleanByFilter(new Date(Date.now() - 7 * 86400000).toISOString(), "allow")}>
            <Clock className="mr-1 h-3 w-3" />{t("audit.clean7d")}
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <div className={cn("flex items-center gap-1.5 font-mono text-xs", sseConnected ? "text-success" : "text-muted-foreground")}>
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", sseConnected ? "bg-success animate-pulse-glow" : "bg-muted-foreground")} />
            {sseConnected ? t("audit.live") : t("audit.offline")}
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExportCsv}>
            <Download className="mr-1 h-3 w-3" />{t("audit.exportCsv")}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => fetchData(data.page)}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border/50">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10"><Checkbox checked={data.rows.length > 0 && selectedIds.size === data.rows.length} onCheckedChange={toggleSelectAll} /></TableHead>
              <TableHead className="w-6" />
              <TableHead className="font-mono text-sm uppercase tracking-wider">{t("audit.col.time")}</TableHead>
              <TableHead className="font-mono text-sm uppercase tracking-wider">{t("audit.col.method")}</TableHead>
              <TableHead className="font-mono text-sm uppercase tracking-wider">{t("audit.col.path")}</TableHead>
              <TableHead className="font-mono text-sm uppercase tracking-wider">{t("audit.col.type")}</TableHead>
              <TableHead className="font-mono text-sm uppercase tracking-wider">{t("audit.col.size")}</TableHead>
              <TableHead className="font-mono text-sm uppercase tracking-wider">{t("audit.col.findings")}</TableHead>
              <TableHead className="font-mono text-sm uppercase tracking-wider">{t("audit.col.action")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && data.rows.length === 0 && (
              <TableRow><TableCell colSpan={9} className="h-40 text-center text-sm text-muted-foreground">{t("audit.loading")}</TableCell></TableRow>
            )}
            {!loading && data.rows.length === 0 && (
              <TableRow><TableCell colSpan={9} className="h-40 text-center text-sm text-muted-foreground">{t("audit.noRecords")}</TableCell></TableRow>
            )}
            {data.rows.map((row) => {
              const expanded = expandedIds.has(row.id);
              const selected = selectedIds.has(row.id);
              const clickRow = (e: React.MouseEvent) => { e.stopPropagation(); toggleExpand(row.id); };
              return (
                <Fragment key={row.id}>
                  <TableRow data-state={selected ? "selected" : undefined} className={cn(row.action === "block" && "bg-destructive/5", row.action === "mask" && "bg-warning/5")}>
                    <TableCell onClick={(e) => e.stopPropagation()}><Checkbox checked={selected} onCheckedChange={() => toggleSelect(row.id)} /></TableCell>
                    <TableCell><button onClick={clickRow} className="text-muted-foreground hover:text-foreground">{expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button></TableCell>
                    <TableCell onClick={clickRow} className="cursor-pointer font-mono text-xs tabular-nums text-muted-foreground">{formatTime(row.timestamp)}</TableCell>
                    <TableCell onClick={clickRow}><Badge variant="outline" className="font-mono text-xs">{row.method}</Badge></TableCell>
                    <TableCell onClick={clickRow} className="cursor-pointer max-w-[280px] truncate text-sm">{row.path}</TableCell>
                    <TableCell onClick={clickRow} className="cursor-pointer text-xs text-muted-foreground"><span className="max-w-[120px] truncate inline-block align-bottom">{row.contentType}</span></TableCell>
                    <TableCell onClick={clickRow} className="cursor-pointer font-mono text-xs tabular-nums text-muted-foreground">{formatBytes(row.bodySize)}</TableCell>
                    <TableCell onClick={clickRow}>
                      <div className="flex flex-wrap gap-1">
                        {row.findings.slice(0, 2).map((f) => (<Badge key={f} variant="outline" className="font-mono text-xs">{f}</Badge>))}
                        {row.findings.length > 2 && (<Badge variant="outline" className="font-mono text-xs text-muted-foreground">+{row.findings.length - 2}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell onClick={clickRow}><ActionBadge action={row.action} label={t(`action.${row.action}`)} /></TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={9} className="p-0">
                        <div className="border-b border-border/50 bg-card/80 px-4 py-3">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <code className="font-mono text-sm text-muted-foreground">#{row.id}</code>
                              <Badge variant="outline" className="font-mono text-xs">{row.method}</Badge>
                              <ActionBadge action={row.action} label={t(`action.${row.action}`)} />
                            </div>
                            <Button variant="destructive" size="sm" className="h-6 text-xs" onClick={() => handleDeleteSingle(row.id)}>
                              <Trash2 className="mr-1 h-3 w-3" />{t("audit.delete")}
                            </Button>
                          </div>
                          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                            <div><span className="text-muted-foreground">{t("audit.pathLabel")}: </span><code className="font-mono text-sm">{row.path}</code></div>
                             <div><span className="text-muted-foreground">{t("audit.contentTypeLabel")}: </span><code className="font-mono text-sm">{row.contentType}</code></div>
                             <div><span className="text-muted-foreground">{t("audit.bodySizeLabel")}: </span><span className="font-mono text-sm">{formatBytes(row.bodySize)}</span></div>
                             <div><span className="text-muted-foreground">{t("audit.timeLabel")}: </span><span className="font-mono text-sm">{formatTime(row.timestamp)}</span></div>
                          </div>
                          {row.findings.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5">{t("audit.findingsLabel")}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {row.findings.map((f) => (<Badge key={f} variant={f === "SENSITIVE_FILENAME" ? "destructive" : ["PHONE", "EMAIL", "ID_CARD", "BANK_CARD"].includes(f) ? "warning" : "outline"} className="font-mono text-xs">{f}</Badge>))}
                              </div>
                            </div>
                          )}
                          {row.filenames.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5">{t("audit.filenamesLabel")}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {row.filenames.map((f) => (<code key={f} className="rounded border border-border/30 bg-muted px-1.5 py-0.5 font-mono text-xs">{f}</code>))}
                              </div>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="font-mono text-sm text-muted-foreground">
          {data.total.toLocaleString()} {t("audit.records")} — {t("audit.page")} {data.page} {t("audit.pageOf")} {totalPages || 1}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={data.page <= 1} onClick={() => fetchData(data.page - 1)}>{t("audit.prev")}</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={data.page >= totalPages} onClick={() => fetchData(data.page + 1)}>{t("audit.next")}</Button>
        </div>
      </div>

      {/* Delete Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog((d) => ({ ...d, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />{deleteDialog.title}</DialogTitle>
            <DialogDescription>{deleteDialog.desc}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteDialog((d) => ({ ...d, open: false }))}>{t("audit.cancel")}</Button>
            <Button variant="destructive" size="sm" onClick={deleteDialog.onConfirm}>{t("audit.delete")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Clean Dialog */}
      <Dialog open={cleanDialog.open} onOpenChange={(open) => setCleanDialog((d) => ({ ...d, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-warning" />{t("audit.confirmCleanup")}</DialogTitle>
            <DialogDescription>
              {t("audit.confirmCleanupDesc", {
                date: new Date(cleanDialog.before).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US"),
                action: cleanDialog.action ? t(`action.${cleanDialog.action}`) : t("action.any"),
                count: cleanDialog.count ?? "…",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setCleanDialog((d) => ({ ...d, open: false }))}>{t("audit.cancel")}</Button>
            <Button variant="destructive" size="sm" onClick={confirmClean} disabled={!cleanDialog.count}>
              {t("audit.delete")}{(cleanDialog.count ?? 0) > 0 ? ` (${cleanDialog.count})` : ""}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
