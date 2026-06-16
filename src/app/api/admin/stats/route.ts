import { NextResponse } from "next/server";
import { getAuditStats } from "@/audit";
import { checkAdminAuth } from "@/lib/admin-auth";
import { Logger } from "@/log";

const log = new Logger("admin");

export async function GET(request: Request) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const stats = getAuditStats();
    return NextResponse.json(stats);
  } catch (err) {
    log.error(`stats GET failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
