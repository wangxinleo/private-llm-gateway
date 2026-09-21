import type { SseChannelRestorer } from "./restore";
import type { StreamResponseAnalyzer } from "./response-analysis";
import { classifyContentEncoding, decodeZstdStream } from "./content-encoding";
import { Logger } from "@/log";

const log = new Logger("streaming");

export function createStreamingResponse(
  upstream: Response,
  restorer?: SseChannelRestorer,
  analyzer?: StreamResponseAnalyzer
): Response {
  const headers = new Headers(upstream.headers);
  headers.delete("content-length");
  const encoding = classifyContentEncoding(headers);
  // 客户端已解压的编码必须摘头(头体一致性);zstd 由网关解压后再摘头
  if (encoding === "decoded" || encoding === "zstd") {
    headers.delete("content-encoding");
  }
  // 未知编码无解码手段:原样字节透传,放弃还原/分析(否则按文本处理会产出乱码),保留原头
  const opaque = encoding === "unknown";
  if (opaque) {
    log.warn(`unsupported content-encoding, streaming passthrough: ${headers.get("content-encoding")}`);
    restorer = undefined;
    analyzer = undefined;
  }

  let body = upstream.body;
  if (encoding === "zstd" && body) {
    body = decodeZstdStream(body);
  }

  const reader = body?.getReader();
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
