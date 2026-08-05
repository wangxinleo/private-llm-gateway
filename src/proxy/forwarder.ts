import { UPSTREAM_URL } from "@/config";

export async function forwardRequest(
  path: string,
  request: Request,
  body?: BodyInit
): Promise<Response> {
  const url = `${UPSTREAM_URL}${path}`;
  const headers = new Headers(request.headers);
  headers.delete("host");

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
