import { getDefaultUpstream } from "@/config";
import type { ResolvedChannel } from "./channels";

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
