import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/admin-auth";
import { createBypassRule, listBypassRules } from "@/bypass/store";
import { Logger } from "@/log";

const log = new Logger("admin");

function isValidIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function GET(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    return NextResponse.json({ rows: listBypassRules() });
  } catch (err) {
    log.error(`bypass-rules GET failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    if (
      !isNonEmptyString(body.pathPrefix) ||
      !isNonEmptyString(body.modelName) ||
      !isValidIso(body.startAt) ||
      !isValidIso(body.endAt)
    ) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    if (Date.parse(body.startAt) >= Date.parse(body.endAt)) {
      return NextResponse.json({ error: "invalid_time_window" }, { status: 400 });
    }

    const created = createBypassRule({
      enabled: body.enabled !== false,
      pathPrefix: body.pathPrefix.trim(),
      modelName: body.modelName.trim(),
      startAt: body.startAt,
      endAt: body.endAt,
      note: typeof body.note === "string" ? body.note.trim() : "",
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    log.error(`bypass-rules POST failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
