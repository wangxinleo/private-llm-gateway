import { CCLOAD_URL } from "@/config";

export async function forwardRequest(
  path: string,
  request: Request,
  body?: BodyInit
): Promise<Response> {
  const url = `${CCLOAD_URL}${path}`;
  const headers = new Headers(request.headers);
  headers.delete("host");

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (body !== undefined) {
    headers.delete("content-length");
    init.body = body;
  } else if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  return fetch(url, init);
}
