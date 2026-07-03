import type { Finding, ActionType, AuditEntry, ScanResult } from "@/types";
import { insertAudit } from "./store";
import { broadcastAudit } from "./sse";

export function logAudit(params: {
  path: string;
  method: string;
  contentType: string;
  bodySize: number;
  model?: string;
  filenames: string[];
  findings: Finding[];
  action: ActionType;
  scanResult?: ScanResult;
  bypassApplied?: boolean;
  duration?: number;
}): void {
  const matchedValues = params.findings.reduce<Record<string, string[]>>((acc, finding) => {
    const values = acc[finding.category] ?? [];
    values.push(finding.matched);
    acc[finding.category] = values;
    return acc;
  }, {});

  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    path: params.path,
    method: params.method,
    contentType: params.contentType,
    bodySize: params.bodySize,
    model: params.model,
    filenames: params.filenames,
    findings: params.findings.map((f) => f.category),
    matchedValues,
    action: params.action,
  };

  if (params.bypassApplied) {
    entry.bypassApplied = true;
  }

  if (params.duration !== undefined) {
    entry.duration = params.duration;
  }

  if (params.scanResult?.maskSummary) {
    const ms = params.scanResult.maskSummary;
    entry.maskApplied = ms.applied;
    entry.maskCategories = ms.categories;
    entry.maskCount = ms.replacementCount;
  }

  const id = insertAudit(entry);

  broadcastAudit({
    id,
    timestamp: entry.timestamp,
    path: entry.path,
    method: entry.method,
    contentType: entry.contentType,
    bodySize: entry.bodySize,
    model: entry.model,
    filenames: entry.filenames,
    findings: entry.findings,
    action: entry.action,
    bypassApplied: entry.bypassApplied,
    duration: entry.duration,
  });
}
