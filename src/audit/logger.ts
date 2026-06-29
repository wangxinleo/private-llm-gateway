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
}): void {
  const matchedValues: Record<string, string[]> = {};
  for (const finding of params.findings) {
    const values = matchedValues[finding.category] ?? [];
    values.push(finding.matched);
    matchedValues[finding.category] = values;
  }

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
  });
}
