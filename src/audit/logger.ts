import type { Finding, ActionType, AuditEntry } from "@/types";
import { insertAudit } from "./store";
import { broadcastAudit } from "./sse";

export function logAudit(params: {
  path: string;
  method: string;
  contentType: string;
  bodySize: number;
  filenames: string[];
  findings: Finding[];
  action: ActionType;
}): void {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    path: params.path,
    method: params.method,
    contentType: params.contentType,
    bodySize: params.bodySize,
    filenames: params.filenames,
    findings: params.findings.map((f) => f.category),
    action: params.action,
  };

  const id = insertAudit(entry);

  broadcastAudit({
    id,
    timestamp: entry.timestamp,
    path: entry.path,
    method: entry.method,
    contentType: entry.contentType,
    bodySize: entry.bodySize,
    filenames: entry.filenames,
    findings: entry.findings,
    action: entry.action,
  });
}
