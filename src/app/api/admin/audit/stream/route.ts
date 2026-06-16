import { subscribeAudit } from "@/audit/sse";
import { checkAdminAuth } from "@/lib/admin-auth";

export async function GET(request: Request) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  const encoder = new TextEncoder();
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = null;
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
  };

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`));

      unsubscribe = subscribeAudit((msg) => {
        try {
          controller.enqueue(encoder.encode(msg));
        } catch {
          cleanup();
        }
      });

      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          cleanup();
        }
      }, 15000);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
