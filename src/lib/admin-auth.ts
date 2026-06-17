import { NextResponse } from "next/server";

export function checkAdminAuth(req: Request): NextResponse | null {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });
  }
  const provided = req.headers.get("x-admin-key") || new URL(req.url).searchParams.get("key");
  if (provided !== adminKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
