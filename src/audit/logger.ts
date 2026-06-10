import type { Finding, ActionType, AuditEntry } from "@/types";
import { insertAudit } from "./store";

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

  insertAudit(entry);
}
