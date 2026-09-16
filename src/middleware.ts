import { NextRequest, NextResponse } from "next/server";

// 管理面 Origin 校验(R6):x-admin-key 仍是主防线,此处叠加防跨站调用 admin API。
// 逃生舱:DISABLE_ORIGIN_CHECK=1;反代场景:TRUST_PROXY=1 信任单跳 X-Forwarded-Proto/Host。
function allowedOrigins(request: NextRequest): string[] {
  const origins = new Set<string>();
  try {
    origins.add(new URL(request.url).origin);
  } catch {
    /* 忽略解析失败 */
  }
  // Next.js 用服务端绑定地址构造 request.url(standalone 为 0.0.0.0:PORT,dev 为 localhost:PORT),
  // 与浏览器实际来源无关;同源判定以 Host 头为准(无法感知终端 scheme,http/https 均纳入)。
  const host = request.headers.get("host");
  if (host) {
    origins.add(`http://${host}`);
    origins.add(`https://${host}`);
  }
  const extra = process.env.ALLOWED_ORIGINS ?? "";
  for (const item of extra.split(",")) {
    const trimmed = item.trim().replace(/\/$/, "");
    if (trimmed) origins.add(trimmed);
  }
  return [...origins];
}

function requestOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin || origin === "null") return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  if (process.env.DISABLE_ORIGIN_CHECK === "1") return NextResponse.next();

  const rawOrigin = request.headers.get("origin") ?? request.headers.get("referer");
  // 沙箱化 iframe 会发 Origin: null——不存在合法同源场景,直接拒绝
  if (rawOrigin === "null") {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }
  if (!rawOrigin) return NextResponse.next();

  const origin = requestOrigin(request);
  if (!origin) return NextResponse.next();

  const allowed = new Set(allowedOrigins(request));
  if (process.env.TRUST_PROXY === "1") {
    const proto = (request.headers.get("x-forwarded-proto") ?? "https").split(",")[0]?.trim();
    const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0]?.trim();
    if (host) allowed.add(`${proto}://${host}`);
  }

  if (allowed.has(origin)) return NextResponse.next();
  return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
}

export const config = {
  matcher: ["/api/admin/:path*"],
};
