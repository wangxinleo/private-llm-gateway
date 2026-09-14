import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/admin-auth";
import { countRecentBySeverity, listSignalsByAuditIds, querySignals } from "@/audit/signals-store";
import { Logger } from "@/log";

const log = new Logger("admin");

// GET /api/admin/signals?audit_id=1            → 某审计行的信号
// GET /api/admin/signals?audit_ids=1,2,3       → 批量行信号(审计页展开)
// GET /api/admin/signals?hours=24&summary=1    → 概览计数
// GET /api/admin/signals?page=&signal=&severity=&from=&to= → 信号列表
export async function GET(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const params = new URL(request.url).searchParams;

    const summary = params.get("summary");
    if (summary) {
      const hours = Math.min(720, Math.max(1, parseInt(params.get("hours") ?? "24", 10) || 24));
      return NextResponse.json({ counts: countRecentBySeverity(hours) });
    }

    const auditIdsParam = params.get("audit_ids");
    if (auditIdsParam) {
      const ids = auditIdsParam
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isInteger(v) && v > 0)
        .slice(0, 200);
      return NextResponse.json({ rows: listSignalsByAuditIds(ids) });
    }

    const auditId = params.get("audit_id");
    if (auditId) {
      const id = Number(auditId);
      if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: "invalid_audit_id" }, { status: 400 });
      }
      return NextResponse.json({ rows: listSignalsByAuditIds([id]) });
    }

    const result = querySignals({
      page: parseInt(params.get("page") ?? "1", 10) || 1,
      limit: parseInt(params.get("limit") ?? "50", 10) || 50,
      signal: params.get("signal") ?? undefined,
      severity: params.get("severity") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    log.error(`signals GET failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
