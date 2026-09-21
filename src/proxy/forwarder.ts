import { getDefaultUpstream } from "@/config";
import { filterAcceptEncoding } from "./content-encoding";
import type { ResolvedChannel } from "./channels";

// 不透传的请求头：Expect 是客户端↔网关这一段的重协商机制（Node 已处理），
// 且 undici 明确不支持（UND_ERR_NOT_SUPPORTED）——curl 对大体积 POST(>1KB)
// 默认携带 Expect: 100-continue，透传会让所有大请求 502（2026-09-21 1MB 压测实测）。
// 其余为 RFC 7230 逐跳头，代理不应透传；Authorization 等业务头照常透传。
const DROPPED_REQUEST_HEADERS = [
  "expect",
  "connection",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

export async function forwardRequest(
  path: string,
  request: Request,
  body?: BodyInit,
  channel?: ResolvedChannel
): Promise<Response> {
  // 渠道优先;无渠道时走默认上游(调用方已保证 getDefaultUpstream() 非空)
  const fallback = channel ? null : getDefaultUpstream();
  const url = channel
    ? `${channel.target}${channel.forwardPath}`
    : `${fallback ?? ""}${path}`;
  const headers = new Headers(request.headers);
  headers.delete("host");
  for (const name of DROPPED_REQUEST_HEADERS) headers.delete(name);
  // 只向上游宣告网关能解码的编码:undici 解 gzip/deflate/br 但不解 zstd,
  // 透传 zstd 会让还原链读到未解压字节(实测)。
  const acceptEncoding = headers.get("accept-encoding");
  if (acceptEncoding !== null) {
    headers.set("accept-encoding", filterAcceptEncoding(acceptEncoding));
  }

  if (channel) {
    // 仅补调用方未持有的头(大小写不敏感),绝不覆盖真 Key/协议头(maskit 教训 #8)
    for (const [key, value] of Object.entries(channel.extraHeaders)) {
      if (!headers.has(key)) headers.set(key, value);
    }
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (body !== undefined) {
    headers.delete("content-length");
    if (body instanceof FormData) {
      // fetch 会为 FormData 生成新 boundary;保留旧 multipart content-type 会导致 boundary 不匹配
      headers.delete("content-type");
    }
    init.body = body;
  } else if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  return fetch(url, init);
}
