import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/admin-auth";
import { deleteBypassRule, reactivateBypassRule, updateBypassRule } from "@/bypass/store";
import { Logger } from "@/log";

const log = new Logger("admin");

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isValidIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

    const body = await request.json();

    if (body.reactivate === true) {
      const reactivated = reactivateBypassRule(id);
      if (!reactivated) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json(reactivated);
    }

    if (
      (body.startAt !== undefined && !isValidIso(body.startAt)) ||
      (body.endAt !== undefined && !isValidIso(body.endAt))
    ) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const updated = updateBypassRule(id, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      pathPrefix: typeof body.pathPrefix === "string" ? body.pathPrefix.trim() : undefined,
      modelName: typeof body.modelName === "string" ? body.modelName.trim() : undefined,
      startAt: typeof body.startAt === "string" ? body.startAt : undefined,
      endAt: typeof body.endAt === "string" ? body.endAt : undefined,
      note: typeof body.note === "string" ? body.note.trim() : undefined,
    });

    if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    log.error(`bypass-rules PATCH failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

    return NextResponse.json({ deleted: deleteBypassRule(id) });
  } catch (err) {
    log.error(`bypass-rules DELETE failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
