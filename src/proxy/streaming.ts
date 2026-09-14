import type { SseChannelRestorer } from "./restore";
import type { StreamResponseAnalyzer } from "./response-analysis";

export function createStreamingResponse(
  upstream: Response,
  restorer?: SseChannelRestorer,
  analyzer?: StreamResponseAnalyzer
): Response {
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
              if (tail) {
                analyzer?.observe(tail);
                controller.enqueue(encoder.encode(tail));
              }
            }
            analyzer?.finish();
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
            analyzer?.observe(frames);
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
