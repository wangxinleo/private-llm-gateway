import { NextRequest, NextResponse } from "next/server";
import { queryAudit, deleteAuditByIds, deleteAuditByFilter, countAuditByFilter } from "@/audit";
import type { DeleteFilter } from "@/audit";
import { checkRevealAuth } from "@/app/api/admin/reveal-auth/auth";
import { checkAdminAuth } from "@/lib/admin-auth";
import { Logger } from "@/log";

const log = new Logger("admin");

interface AdminAuditResponseRow {
  id: number;
  timestamp: string;
  path: string;
  method: string;
  contentType: string;
  bodySize: number;
  model?: string;
  filenames: string[];
  findings: string[];
  matchedValues?: Record<string, string[]>;
  action: string;
  bypassApplied: boolean;
  duration?: number;
}

export async function GET(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;
  const isRevealed = checkRevealAuth(request);

  try {
    const { searchParams } = request.nextUrl;
    const params = {
      page: parseInt(searchParams.get("page") ?? "1", 10),
      limit: parseInt(searchParams.get("limit") ?? "50", 10),
      action: searchParams.get("action") ?? undefined,
      finding: searchParams.get("finding") ?? undefined,
      method: searchParams.get("method") ?? undefined,
      q: searchParams.get("q") ?? undefined,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
    };

    const { rows, total } = queryAudit(params);

    const mappedRows = rows.map((r) => {
      const row: AdminAuditResponseRow = {
        id: r.id,
        timestamp: r.timestamp,
        path: r.path,
        method: r.method,
        contentType: r.content_type,
        bodySize: r.body_size,
        model: r.model || undefined,
        filenames: JSON.parse(r.filenames) as string[],
        findings: JSON.parse(r.findings) as string[],
        action: r.action,
        bypassApplied: r.bypass_applied === 1,
        duration: r.duration != null ? r.duration : undefined,
      };

      if (isRevealed) {
        row.matchedValues = JSON.parse(r.matched_values) as Record<string, string[]>;
      }

      return row;
    });

    return NextResponse.json({
      rows: mappedRows,
      total,
      page: params.page,
      limit: params.limit,
    });
  } catch (err) {
    log.error(`audit GET failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const isDryRun = request.nextUrl.searchParams.get("dryRun") === "true";

    if (body.ids) {
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        return NextResponse.json({ error: "ids must be non-empty array" }, { status: 400 });
      }
      if (!body.ids.every((id: unknown) => typeof id === "number" && Number.isInteger(id) && id > 0)) {
        return NextResponse.json({ error: "ids must be positive integers" }, { status: 400 });
      }
      if (body.ids.length > 1000) {
        return NextResponse.json({ error: "ids array exceeds 1000 limit" }, { status: 400 });
      }
      if (isDryRun) {
        return NextResponse.json({ wouldDelete: body.ids.length });
      }
      const deleted = deleteAuditByIds(body.ids);
      return NextResponse.json({ deleted });
    }

    if (body.filter) {
      const filter: DeleteFilter = body.filter;
      if (!filter.before) {
        return NextResponse.json({ error: "filter.before is required" }, { status: 400 });
      }
      if (isDryRun) {
        const wouldDelete = countAuditByFilter(filter);
        return NextResponse.json({ wouldDelete });
      }
      const deleted = deleteAuditByFilter(filter);
      return NextResponse.json({ deleted });
    }

    return NextResponse.json({ error: "must provide ids or filter" }, { status: 400 });
  } catch (err) {
    log.error(`audit DELETE failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
