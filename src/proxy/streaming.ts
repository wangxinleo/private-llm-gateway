import type { SseChannelRestorer } from "./restore";
import type { StreamResponseAnalyzer } from "./response-analysis";
import { classifyContentEncoding, decodeZstdStream } from "./content-encoding";
import { describeUpstreamError, formatUpstreamError } from "./error-trace";
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
  const startedAt = performance.now();
  let outBytes = 0;
  // 客户端主动断开标记:取消后 pull 循环的 close/enqueue 会抛 ERR_INVALID_STATE,
  // 那不是上游故障,不得记为 upstream_error(HIGH)
  let clientCancelled = false;

  const stream = new ReadableStream({
    async pull(controller) {
      const emit = (chunk: Uint8Array) => {
        outBytes += chunk.byteLength;
        controller.enqueue(chunk);
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            if (restorer) {
              const tail = restorer.flush();
              if (tail) {
                analyzer?.observe(tail);
                emit(encoder.encode(tail));
              }
            }
            analyzer?.finish();
            controller.close();
            return;
          }
          if (!restorer) {
            emit(value);
            return;
          }
          const decoded = decoder.decode(value, { stream: true });
          if (!decoded) continue;
          const frames = restorer.pushBytes(decoded);
          if (frames) {
            analyzer?.observe(frames);
            emit(encoder.encode(frames));
            return;
          }
        }
      } catch (err) {
        // 客户端取消:连接已断,不 warn、不落信号、不 error
        if (clientCancelled) {
          log.debug(
            `client cancelled stream mid-response (out=${outBytes}B, ms=${(performance.now() - startedAt).toFixed(1)})`
          );
          return;
        }
        // 流式中断此前完全静默(仅 controller.error):先留痕再 error。
        // 诊断只含元数据;客户端截断语义不变
        const trace = describeUpstreamError(err, { resp: 1, out: outBytes, ms: performance.now() - startedAt });
        log.warn(`stream aborted mid-response ${formatUpstreamError(trace)}`);
        analyzer?.recordAbort(trace);
        controller.error(err);
      }
    },
    cancel(reason) {
      clientCancelled = true;
      return reader.cancel(reason).catch(() => {});
    },
  });

  return new Response(stream, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
