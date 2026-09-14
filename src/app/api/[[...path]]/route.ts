import { NextRequest } from "next/server";
import type { Finding, MaskSummary, ScanResult } from "@/types";
import { runPipeline } from "@/scanner/pipeline";
import { MaskRegistry } from "@/scanner/mask-registry";
import { isJsonContentType, maskJsonBody } from "@/scanner/json-mask";
import { parseMultipart, collectMultipartText, collectFilenames } from "@/scanner/multipart";
import { applyMasks } from "@/scanner/pii";
import { blockedResponse } from "@/engine/policy";
import { forwardRequest } from "@/proxy/forwarder";
import { createStreamingResponse } from "@/proxy/streaming";
import { SseChannelRestorer, restoreText } from "@/proxy/restore";
import { applyDisambiguation } from "@/proxy/disambiguation";
import { logAudit } from "@/audit/logger";
import { Logger } from "@/log";
import { PRIVACY_DEBUG_HEADERS, PRIVACY_MASK_FORMAT, RUNTIME } from "@/config";
import { initializeConfigs } from "@/config-loader";
import { initRetentionScheduler } from "@/audit/retention";
import { findMatchingBypassRule } from "@/bypass/store";
import { extractRequestModel } from "@/bypass/rules";

const log = new Logger("proxy");

const MULTIPART = "multipart/form-data";

function extractPath(request: NextRequest): string {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  return `${path}${url.search}`;
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

function isBinaryContentType(contentType: string): boolean {
  return /^(?:image|audio|video)\//.test(contentType) || contentType.includes("application/octet-stream");
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

async function finalizeUpstream(
  upstream: Response,
  registry: MaskRegistry | undefined,
  maskSummary: MaskSummary
): Promise<Response> {
  if (!registry || registry.size === 0) return upstream;
  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return createStreamingResponse(upstream, new SseChannelRestorer(registry));
  }
  if (!upstream.body || isBinaryContentType(contentType)) return upstream;
  const restored = restoreText(await upstream.text(), registry);
  const headers = new Headers(upstream.headers);
  headers.delete("content-length");
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

async function handleRequest(request: NextRequest): Promise<Response> {
  const startTime = performance.now();
  initializeConfigs();
  initRetentionScheduler();
  const path = extractPath(request);
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
    if (bypassResult) {
      const bypassHitCategories = bypassResult.findings.map(f => f.category).join(", ");
      const bypassDurationMs = performance.now() - startTime;
      log.info(`${method} ${path} | action: allow (bypass) | hits: ${bypassHitCategories || "none"} | ${bypassDurationMs.toFixed(2)}ms`);

      logAudit({
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
    } else {
      const durationMs = performance.now() - startTime;
      logAudit({
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
    }

    try {
      const upstream = await forwardRequest(
        path,
        request,
        hasBody && !multipart ? bodyText : multipart ? await request.formData() : undefined
      );
      const upstreamContentType = upstream.headers.get("content-type") ?? "";
      if (upstreamContentType.includes("text/event-stream")) {
        return createStreamingResponse(upstream);
      }
      return upstream;
    } catch (err) {
      const cause = err instanceof Error && "cause" in err ? (err.cause as Error) : undefined;
      const code = cause && "code" in cause ? (cause as { code: string }).code : undefined;
      log.warn(`${method} ${path} | upstream error: fetch_failed${code ? ` (${code})` : ""}`);
      log.debug(`upstream error detail: ${err instanceof Error ? err.message : String(err)}`);
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

  logAudit({
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

  if (result.action === "block") {
    const blocked = blockedResponse(result.findings);
    return Response.json(blocked.body, { status: blocked.status });
  }

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

    const upstream = await forwardRequest(
      path,
      request,
      forwardBody
    );

    return finalizeUpstream(upstream, registry, result.maskSummary);
  } catch (err) {
    const cause = err instanceof Error && "cause" in err ? (err.cause as Error) : undefined;
    const code = cause && "code" in cause ? (cause as { code: string }).code : undefined;
    log.warn(`${method} ${path} | upstream error: fetch_failed${code ? ` (${code})` : ""}`);
    log.debug(`upstream error detail: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json(
      { error: "upstream_error" },
      { status: 502 }
    );
  }
}
