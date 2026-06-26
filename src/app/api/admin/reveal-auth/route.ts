import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/admin-auth";
import { REVEAL_MAX_AGE, cleanupExpiredTokens, getRevealExpiry, revealTokens, checkRevealAuth, getCookie } from "./auth";

export async function GET(request: Request) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;
  const active = checkRevealAuth(request);
  if (!active) return NextResponse.json({ active: false });
  const token = getCookie(request, "reveal_token");
  const expiresAt = token ? revealTokens.get(token) : undefined;
  return NextResponse.json({ active: true, expiresAt });
}

export async function POST(request: Request) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  const adminKey = process.env.ADMIN_KEY;
  const body = await request.json().catch((): { password?: unknown } => ({}));
  if (body.password !== adminKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  cleanupExpiredTokens(now);
  const token = randomBytes(32).toString("hex");
  const expiresAt = getRevealExpiry(now);
  revealTokens.set(token, expiresAt);

  return NextResponse.json(
    { expiresAt: new Date(expiresAt).toISOString() },
    {
      headers: {
        "Set-Cookie": `reveal_token=${token}; Max-Age=${REVEAL_MAX_AGE}; HttpOnly; SameSite=Strict; Path=/api/admin`,
      },
    }
  );
}
