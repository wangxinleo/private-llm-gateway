import { NextRequest } from "next/server";
import type { Finding, MaskSummary, ScanResult } from "@/types";
import { runPipeline } from "@/scanner/pipeline";
import { MaskRegistry } from "@/scanner/mask-registry";
import { isJsonContentType, maskJsonBody } from "@/scanner/json-mask";
import { parseMultipart, collectMultipartText, collectFilenames } from "@/scanner/multipart";
import { applyMasks } from "@/scanner/pii";
import { blockedResponse } from "@/engine/policy";
import { forwardRequest } from "@/proxy/forwarder";
import { resolveChannel, type ResolvedChannel } from "@/proxy/channels";
import { describeUpstreamError, formatUpstreamError } from "@/proxy/error-trace";
import { createStreamingResponse } from "@/proxy/streaming";
import { classifyContentEncoding, decodeZstdBuffer, stripDecodedContentEncoding } from "@/proxy/content-encoding";
import { SseChannelRestorer, restoreText, type RestoreStats } from "@/proxy/restore";
import { analyzeResponse, StreamResponseAnalyzer } from "@/proxy/response-analysis";
import { analyzeRequestInjection } from "@/proxy/request-analysis";
import { applyDisambiguation } from "@/proxy/disambiguation";
import { findResidualPlaceholders } from "@/scanner/placeholder-scan";
import { logAudit, recordRestoreStats } from "@/audit/logger";
import { insertSignals } from "@/audit/signals-store";
import { Logger } from "@/log";
import { PRIVACY_DEBUG_HEADERS, PRIVACY_MASK_FORMAT, RUNTIME, getDefaultUpstream } from "@/config";
import { initializeConfigs } from "@/config-loader";
import { initRetentionScheduler } from "@/audit/retention";
import { findMatchingBypassRule } from "@/bypass/store";
import { extractRequestModel } from "@/bypass/rules";

const log = new Logger("proxy");

const MULTIPART = "multipart/form-data";

function extractPath(request: NextRequest): string {
  // 根路径代理:path 原样(含 query);渠道前缀即首段,不再有固定 api 段
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

function isMultipart(contentType: string): boolean {
  return contentType.toLowerCase().startsWith(MULTIPART);
}

function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

async function extractBodyText(
  request: NextRequest
): Promise<{ text: string; filenames: string[]; size: number }> {
  const contentType = request.headers.get("content-type") ?? "";
  const cloned = request.clone();

  if (isMultipart(contentType)) {
    const result = await parseMultipart(cloned);
    const text = collectMultipartText(result);
    return {
      text,
      filenames: collectFilenames(result),
      size: parseInt(request.headers.get("content-length") ?? "0", 10),
    };
  }

  const text = await cloned.text();
  return { text, filenames: [], size: byteLength(text) };
}

async function rebuildMaskedMultipart(
  request: NextRequest,
  findings: Finding[],
  registry?: MaskRegistry
): Promise<FormData> {
  const formData = await request.clone().formData();
  const rebuilt = new FormData();
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      rebuilt.append(key, applyMasks(value, findings, registry).masked);
    } else {
      rebuilt.append(key, value);
    }
  }
  return rebuilt;
}

// 上游 content-type 大小写不保证(实测 Text/Event-Stream、Application/Octet-Stream):
// 响应侧判定必须归一化后再匹配,否则二进制被当文本解码破坏、SSE 被当普通响应整流缓冲
function normalizeContentType(contentType: string): string {
  return contentType.toLowerCase().trim();
}

function isSseContentType(contentType: string): boolean {
  return normalizeContentType(contentType).includes("text/event-stream");
}

function isBinaryContentType(contentType: string): boolean {
  const ct = normalizeContentType(contentType);
  return /^(?:image|audio|video)\//.test(ct) || ct.includes("application/octet-stream");
}

function isTooLarge(contentLength: string | null): boolean {
  const declared = parseInt(contentLength ?? "0", 10);
  return Number.isFinite(declared) && declared > RUNTIME.maxBodyBytes;
}

function tooLargeResponse(): Response {
  return Response.json({ error: "payload_too_large" }, { status: 413 });
}

// 扫描/脱敏异常的受控处理:fail_closed → 503 拒绝出网;fail-open → 返回 null 由调用方放行原文
function runScanProtected(operation: string, scan: () => ScanResult): ScanResult | Response | null {
  try {
    return scan();
  } catch (err) {
    log.error(`${operation} scan failed: ${err instanceof Error ? err.message : String(err)}`);
    if (RUNTIME.failClosed) {
      return Response.json({ error: "mask_failed" }, { status: 503 });
    }
    return null;
  }
}

// 透传上游响应前的头归一:客户端已解压的编码(gzip/deflate/br)必须摘掉
// content-encoding(undici 已解压但保留头,不摘会让客户端二次解压明文而失败)
function reemitUpstream(upstream: Response): Response {
  if (!upstream.body) return upstream;
  const headers = new Headers(upstream.headers);
  stripDecodedContentEncoding(headers);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

// 整流路径会把整条响应读进内存并同步还原+分析,超大响应会占住事件循环:
// 超限即跳过还原/分析但绝不改 body,并留痕(restore_skipped 信号)
type CappedRead =
  | { kind: "within"; bytes: Uint8Array; text: string }
  | { kind: "oversized"; stream: ReadableStream<Uint8Array>; bytes: number };

async function readBodyCapped(body: ReadableStream<Uint8Array>, limit: number): Promise<CappedRead> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
    if (total > limit) {
      // 越限:停止累积,已缓冲分片 + 剩余上游流重组为透传流(字节原样、顺序不变)
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
        },
        async pull(controller) {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            return;
          }
          if (next.value) controller.enqueue(next.value);
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      return { kind: "oversized", stream, bytes: total };
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "within", bytes: merged, text: new TextDecoder().decode(merged) };
}

// 跳过留痕:只记数字与原因,不含任何正文(信号挂本次请求,事件页展开可见)
function traceRestoreSkipped(analysis: { auditId: number } | undefined, bytes: number): void {
  log.warn(`response restore skipped: response_too_large (bytes=${bytes}, limit=${RUNTIME.maxBodyBytes})`);
  insertSignals(analysis?.auditId ?? null, [
    { signal: "restore_skipped", severity: "MEDIUM", detail: { reason: "response_too_large", bytes, limit: RUNTIME.maxBodyBytes } },
  ]);
}

// 请求体字节:已实测值优先;multipart 直通(bypass)未提前解析,退回声明 content-length
function requestBytes(bodySize: number, contentLength: string | null): number {
  if (bodySize > 0) return bodySize;
  const declared = parseInt(contentLength ?? "", 10);
  return Number.isFinite(declared) && declared > 0 ? declared : 0;
}

// 上游失败留痕:err/code/resp/req/ms 只进 warn 日志与审计信号(元数据),
// 绝不进客户端响应体(主机名/端口/错误消息零泄漏,route-upstream-error.test.ts 钉死)
function traceUpstreamError(
  err: unknown,
  ctx: { method: string; path: string; resp: 0 | 1; req: number; ms: number; auditId?: number | null }
): void {
  const trace = describeUpstreamError(err, { resp: ctx.resp, req: ctx.req, ms: ctx.ms });
  log.warn(`${ctx.method} ${ctx.path} | upstream error: fetch_failed ${formatUpstreamError(trace)}`);
  log.debug(`upstream error detail: ${err instanceof Error ? err.message : String(err)}`);
  if (ctx.auditId != null) {
    insertSignals(ctx.auditId, [{ signal: "upstream_error", severity: "HIGH", detail: trace }]);
  }
}

async function finalizeUpstream(
  upstream: Response,
  registry: MaskRegistry | undefined,
  maskSummary: MaskSummary,
  analysis?: { auditId: number; requestModel?: string }
): Promise<Response> {
  const contentType = upstream.headers.get("content-type") ?? "";
  const hasRegistry = !!(registry && registry.size > 0);

  if (isSseContentType(contentType)) {
    if (!hasRegistry) return reemitUpstream(upstream);
    const restorer = new SseChannelRestorer(registry);
    const analyzer = analysis
      ? new StreamResponseAnalyzer(
          { status: upstream.status, forwardValues: [...registry!.tagToValue.values()], requestModel: analysis.requestModel },
          analysis.auditId,
          restorer
        )
      : undefined;
    return createStreamingResponse(upstream, restorer, analyzer);
  }
  if (!upstream.body || isBinaryContentType(contentType)) return reemitUpstream(upstream);
  // 还原与响应分析共用这次全文读取;两者都不需要时保持零拷贝透传
  if (!hasRegistry && !analysis) return reemitUpstream(upstream);

  const encoding = classifyContentEncoding(upstream.headers);
  // 未知编码(非 gzip/deflate/br/zstd):无解码手段,原样透传且不做还原/分析
  if (encoding === "unknown") {
    log.warn(`upstream content-encoding unsupported, passthrough without restore: ${upstream.headers.get("content-encoding")}`);
    return reemitUpstream(upstream);
  }

  // 声明体积快速跳过:仅 none/zstd 的 content-length 是可靠代理(无解压增益);
  // decoded(gzip/br)wire 体积≠解码体积,不做快速跳过以免误跳过
  const declared = parseInt(upstream.headers.get("content-length") ?? "", 10);
  if ((encoding === "none" || encoding === "zstd") && Number.isFinite(declared) && declared > RUNTIME.maxBodyBytes) {
    traceRestoreSkipped(analysis, declared);
    return reemitUpstream(upstream);
  }

  const capped = await readBodyCapped(upstream.body, RUNTIME.maxBodyBytes);
  if (capped.kind === "oversized") {
    traceRestoreSkipped(analysis, capped.bytes);
    const wrapped = new Response(capped.stream, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
    });
    return reemitUpstream(wrapped);
  }

  const raw = encoding === "zstd" ? decodeZstdBuffer(capped.bytes) : capped.text;
  const restoreStats: RestoreStats = { restored: 0, degraded: 0 };
  const restored = hasRegistry ? restoreText(raw, registry!, restoreStats) : raw;
  if (analysis) {
    insertSignals(
      analysis.auditId,
      analyzeResponse({
        status: upstream.status,
        text: restored,
        forwardValues: [...registry!.tagToValue.values()],
        requestModel: analysis.requestModel,
      })
    );
    // 计数只在本次请求签发过占位符(registry 非空)时落库:零拷贝/空 registry 不产生还原遍
    if (hasRegistry) {
      const residual = findResidualPlaceholders(restored);
      recordRestoreStats(analysis.auditId, {
        restored: restoreStats.restored,
        degraded: restoreStats.degraded,
        unresolved: residual.count,
        samples: residual.samples,
      });
    }
  }

  const headers = new Headers(upstream.headers);
  headers.delete("content-length");
  if (encoding === "decoded" || encoding === "zstd") {
    headers.delete("content-encoding");
  }
  if (PRIVACY_DEBUG_HEADERS && maskSummary.applied) {
    headers.set("X-Privacy-Masked", "true");
    headers.set("X-Privacy-Mask-Types", maskSummary.categories.join(","));
  }
  return new Response(restored, { status: upstream.status, statusText: upstream.statusText, headers });
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}

export async function GET(request: NextRequest) {
  return handleRequest(request);
}

export async function PUT(request: NextRequest) {
  return handleRequest(request);
}

export async function PATCH(request: NextRequest) {
  return handleRequest(request);
}

export async function DELETE(request: NextRequest) {
  return handleRequest(request);
}

// 无渠道时保持三参调用(既有签名与测试兼容);有渠道时第四参携带解析结果
function forwardToUpstream(
  path: string,
  request: NextRequest,
  body: BodyInit | undefined,
  channel: ResolvedChannel | null
): Promise<Response> {
  return channel
    ? forwardRequest(path, request, body, channel)
    : forwardRequest(path, request, body);
}

async function handleRequest(request: NextRequest): Promise<Response> {
  const startTime = performance.now();
  initializeConfigs();
  initRetentionScheduler();
  const path = extractPath(request);
  // 渠道路由:命中 /<channel>/** 时 strip 前缀转发到渠道 target。
  // 无渠道且未配置默认上游(UPSTREAM_URL)→ 立即 404(防外网枚举常见 API 路径):
  // 不读 body、不扫描、不审计,避免探测面与资源消耗
  const channel = resolveChannel(path);
  if (!channel && !getDefaultUpstream()) {
    log.debug(`${request.method} ${path} | 404 no_default_upstream`);
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const method = request.method;
  const contentType = request.headers.get("content-type") ?? "";
  const multipart = isMultipart(contentType);
  if (isTooLarge(request.headers.get("content-length"))) {
    log.warn(`${method} ${path} | rejected: payload_too_large (content-length)`);
    return tooLargeResponse();
  }
  // legacy 格式歧义不可还原(R7):不分配实例映射,连带禁用响应还原与指令注入
  const registry = PRIVACY_MASK_FORMAT === "legacy" ? undefined : new MaskRegistry();

  const hasBody = method !== "GET" && method !== "HEAD";
  let bodyText = "";
  let filenames: string[] = [];
  let bodySize = 0;

  if (hasBody && !multipart) {
    const extracted = await extractBodyText(request);
    bodyText = extracted.text;
    filenames = extracted.filenames;
    bodySize = extracted.size;
    if (bodySize > RUNTIME.maxBodyBytes) {
      log.warn(`${method} ${path} | rejected: payload_too_large (${bodySize} bytes)`);
      return tooLargeResponse();
    }
  }

  const model = !multipart && bodyText ? extractRequestModel(bodyText) ?? undefined : undefined;

  const bypassRule = !multipart
    ? findMatchingBypassRule({
        path,
        model: model ?? null,
        now: new Date(),
      })
    : null;

  if (bypassRule) {
    let bypassResult: ScanResult | null = null;
    if (hasBody && !multipart) {
      const scanFn = (text: string, size: number) => runPipeline(text, size, filenames);
      const outcome = runScanProtected("bypass", () =>
        isJsonContentType(contentType) ? maskJsonBody(bodyText, scanFn) : runPipeline(bodyText, bodySize, filenames)
      );
      if (outcome instanceof Response) return outcome;
      bypassResult = outcome;
    }
    let bypassAuditId: number;
    if (bypassResult) {
      const bypassHitCategories = bypassResult.findings.map(f => f.category).join(", ");
      const bypassDurationMs = performance.now() - startTime;
      log.info(`${method} ${path} | action: allow (bypass) | hits: ${bypassHitCategories || "none"} | ${bypassDurationMs.toFixed(2)}ms`);

      bypassAuditId = logAudit({
        path,
        method,
        contentType,
        bodySize,
        model,
        filenames,
        findings: bypassResult.findings,
        action: "allow",
        bypassApplied: true,
        duration: bypassDurationMs,
      });
      insertSignals(bypassAuditId, analyzeRequestInjection(bodyText));
    } else {
      const durationMs = performance.now() - startTime;
      bypassAuditId = logAudit({
        path,
        method,
        contentType,
        bodySize,
        model,
        filenames,
        findings: [],
        action: "allow",
        bypassApplied: true,
        duration: durationMs,
      });
      insertSignals(bypassAuditId, analyzeRequestInjection(bodyText));
    }

    let upstreamReceived = false;
    try {
      const upstream = await forwardToUpstream(
        path,
        request,
        hasBody && !multipart ? bodyText : multipart ? await request.formData() : undefined,
        channel
      );
      upstreamReceived = true;
      const upstreamContentType = upstream.headers.get("content-type") ?? "";
      if (isSseContentType(upstreamContentType)) {
        return createStreamingResponse(upstream);
      }
      return reemitUpstream(upstream);
    } catch (err) {
      traceUpstreamError(err, {
        method,
        path,
        resp: upstreamReceived ? 1 : 0,
        req: requestBytes(bodySize, request.headers.get("content-length")),
        ms: performance.now() - startTime,
        auditId: bypassAuditId,
      });
      return Response.json(
        { error: "upstream_error" },
        { status: 502 }
      );
    }
  }

  log.debug(`${method} ${path} | contentType: ${contentType} | bodySize: ${bodySize}`);

  const scanFn = (text: string, size: number) => runPipeline(text, size, filenames, registry);
  if (hasBody && multipart) {
    const extracted = await extractBodyText(request);
    bodyText = extracted.text;
    filenames = extracted.filenames;
    bodySize = extracted.size;
    if (bodySize > RUNTIME.maxBodyBytes) {
      log.warn(`${method} ${path} | rejected: payload_too_large (${bodySize} bytes)`);
      return tooLargeResponse();
    }
  }

  const scanOutcome = runScanProtected("request", () =>
    isJsonContentType(contentType) && !multipart
      ? maskJsonBody(bodyText, scanFn, registry)
      : runPipeline(bodyText, bodySize, filenames, registry)
  );
  if (scanOutcome instanceof Response) return scanOutcome;
  // fail-open:放行原文并按 allow 留痕(无 findings 可记)
  const result: ScanResult = scanOutcome ?? {
    findings: [],
    maskedBody: bodyText,
    action: "allow",
    maskSummary: { applied: false, categories: [], replacementCount: 0 },
    registry,
  };

  const hitCategories = result.findings.map(f => f.category).join(", ");
  const durationMs = performance.now() - startTime;

  if (result.action !== "allow") {
    log.info(`${method} ${path} | action: ${result.action} | hits: ${hitCategories || "none"} | ${durationMs.toFixed(2)}ms`);
  }

  const auditId = logAudit({
    path,
    method,
    contentType,
    bodySize,
    model,
    filenames,
    findings: result.findings,
    action: result.action,
    scanResult: result,
    duration: durationMs,
  });

  // 请求侧注入被动审计(只记录不阻断):分析未脱敏原文,避免脱敏改变字面量
  insertSignals(auditId, analyzeRequestInjection(bodyText));

  if (result.action === "block") {
    const blocked = blockedResponse(result.findings);
    return Response.json(blocked.body, { status: blocked.status });
  }
  let upstreamReceived = false;
  try {
    let forwardBody: BodyInit | undefined;
    if (multipart) {
      // 原始流转发需要 duplex 选项且易出问题;统一用 FormData 重建,
      // 内容完整(字段+文件),fetch 自动生成新 boundary
      forwardBody = result.action === "mask"
        ? await rebuildMaskedMultipart(request, result.findings, registry)
        : await request.formData();
    } else {
      forwardBody = result.action === "mask"
        ? applyDisambiguation({ contentType, maskedBody: result.maskedBody, scanResult: result })
        : hasBody ? bodyText : undefined;
    }

    const upstream = await forwardToUpstream(path, request, forwardBody, channel);
    upstreamReceived = true;

    // legacy 格式(registry undefined)不做响应分析(R3.6)
    // 必须 await:直接 return promise 时其 rejection 不进本 try/catch
    // (finalizeUpstream 读体失败曾因此变成未捕获异常而非 502,2026-09-23 实测)
    return await finalizeUpstream(upstream, registry, result.maskSummary, registry ? { auditId, requestModel: model } : undefined);
  } catch (err) {
    traceUpstreamError(err, {
      method,
      path,
      resp: upstreamReceived ? 1 : 0,
      req: requestBytes(bodySize, request.headers.get("content-length")),
      ms: performance.now() - startTime,
      auditId,
    });
    return Response.json(
      { error: "upstream_error" },
      { status: 502 }
    );
  }
}
