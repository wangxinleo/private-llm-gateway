import type { SseChannelRestorer } from "./restore";

export function createStreamingResponse(upstream: Response, restorer?: SseChannelRestorer): Response {
  const headers = new Headers(upstream.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");

  const reader = upstream.body?.getReader();
  if (!reader) {
    return new Response(null, { status: upstream.status, headers });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            if (restorer) {
              const tail = restorer.flush();
              if (tail) controller.enqueue(encoder.encode(tail));
            }
            controller.close();
            return;
          }
          if (!restorer) {
            controller.enqueue(value);
            return;
          }
          const decoded = decoder.decode(value, { stream: true });
          if (!decoded) continue;
          const frames = restorer.pushBytes(decoded);
          if (frames) {
            controller.enqueue(encoder.encode(frames));
            return;
          }
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
