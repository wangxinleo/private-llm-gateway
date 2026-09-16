import { getUpstreamsVersion, listEnabledUpstreams, type UpstreamRow } from "@/upstreams/store";

// 渠道名不得撞已存在的根级路由段或系统约定:
// - api:/api/admin 管理端树(具体路由优先,撞段不可达)
// - dashboard:控制台页面树
// - admin/health:防与管理系统/健康检查约定混淆
export const RESERVED_CHANNEL_SEGMENTS: ReadonlySet<string> = new Set(["api", "dashboard", "admin", "health"]);

export const CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// extra_headers 注入黑名单:凭据头(防覆盖真 Key)与协议关键头(防破坏请求)
export const EXTRA_HEADER_BLACKLIST: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "cookie",
  "set-cookie",
  "host",
  "content-length",
  "content-type",
]);

export interface ResolvedChannel {
  name: string;
  target: string;
  forwardPath: string;
  extraHeaders: Record<string, string>;
}

let cachedRows: UpstreamRow[] = [];
let cachedVersion = -1;

function enabledUpstreams(): UpstreamRow[] {
  const version = getUpstreamsVersion();
  if (cachedVersion !== version) {
    cachedRows = listEnabledUpstreams();
    cachedVersion = version;
  }
  return cachedRows;
}

function parseExtraHeaders(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// `/api/<channel>/**` → 渠道解析;未命中返回 null(由调用方决定 404 或默认上游回落)
export function resolveChannel(path: string): ResolvedChannel | null {
  const match = /^\/([a-z0-9-]{1,64})(\/.*)?$/.exec(path);
  if (!match) return null;
  const name = match[1]!;
  if (RESERVED_CHANNEL_SEGMENTS.has(name)) return null;
  const upstream = enabledUpstreams().find((u) => u.name === name);
  if (!upstream) return null;
  return {
    name,
    target: upstream.target,
    forwardPath: match[2] ?? "/",
    extraHeaders: parseExtraHeaders(upstream.extra_headers),
  };
}
