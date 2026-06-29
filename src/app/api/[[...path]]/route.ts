import { NextRequest } from "next/server";
import { runPipeline } from "@/scanner/pipeline";
import { isJsonContentType, maskJsonBody } from "@/scanner/json-mask";
import { parseMultipart, collectMultipartText, collectFilenames } from "@/scanner/multipart";
import { blockedResponse } from "@/engine/policy";
import { forwardRequest } from "@/proxy/forwarder";
import { createStreamingResponse } from "@/proxy/streaming";
import { applyDisambiguation } from "@/proxy/disambiguation";
import { logAudit } from "@/audit/logger";
import { Logger } from "@/log";
import { PRIVACY_DEBUG_HEADERS } from "@/config";
import { findMatchingBypassRule } from "@/bypass/store";
import { extractRequestModel } from "@/bypass/rules";

const log = new Logger("proxy");

const MULTIPART = "multipart/form-data";

function extractPath(request: NextRequest): string {
  const url = new URL(request.url);
  return url.pathname.replace(/^\/api/, "") || "/";
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
  const path = extractPath(request);
  const method = request.method;
  const contentType = request.headers.get("content-type") ?? "";
  const multipart = isMultipart(contentType);

  const hasBody = method !== "GET" && method !== "HEAD";
  let bodyText = "";
  let filenames: string[] = [];
  let bodySize = 0;

  if (hasBody && !multipart) {
    const extracted = await extractBodyText(request);
    bodyText = extracted.text;
    filenames = extracted.filenames;
    bodySize = extracted.size;
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
    if (hasBody && !multipart) {
      const scanFn = (text: string, size: number) => runPipeline(text, size, filenames);
      const bypassResult = isJsonContentType(contentType)
        ? maskJsonBody(bodyText, scanFn)
        : runPipeline(bodyText, bodySize, filenames);
      const bypassHitCategories = bypassResult.findings.map(f => f.category).join(", ");
      const bypassDuration = (performance.now() - startTime).toFixed(2);
      log.info(`${method} ${path} | action: allow (bypass) | hits: ${bypassHitCategories || "none"} | ${bypassDuration}ms`);

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
      });
    } else {
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
      });
    }

    try {
      const upstream = await forwardRequest(path, request, hasBody ? bodyText : undefined);
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

  const scanFn = (text: string, size: number) => runPipeline(text, size, filenames);
  if (hasBody && multipart) {
    const extracted = await extractBodyText(request);
    bodyText = extracted.text;
    filenames = extracted.filenames;
    bodySize = extracted.size;
  }

  const result = isJsonContentType(contentType) && !multipart
    ? maskJsonBody(bodyText, scanFn)
    : runPipeline(bodyText, bodySize, filenames);

  const hitCategories = result.findings.map(f => f.category).join(", ");
  const duration = (performance.now() - startTime).toFixed(2);

  if (result.action !== "allow") {
    log.info(`${method} ${path} | action: ${result.action} | hits: ${hitCategories || "none"} | ${duration}ms`);
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
  });

  if (result.action === "block") {
    const blocked = blockedResponse(result.findings);
    return Response.json(blocked.body, { status: blocked.status });
  }

  try {
    const forwardBody = result.action === "mask"
      ? applyDisambiguation({ contentType, maskedBody: result.maskedBody, scanResult: result })
      : hasBody ? bodyText : undefined;

    const upstream = await forwardRequest(
      path,
      request,
      forwardBody
    );

    const upstreamContentType = upstream.headers.get("content-type") ?? "";
    if (upstreamContentType.includes("text/event-stream")) {
      return createStreamingResponse(upstream);
    }

    if (PRIVACY_DEBUG_HEADERS && result.maskSummary.applied) {
      const headers = new Headers(upstream.headers);
      headers.set("X-Privacy-Masked", "true");
      headers.set("X-Privacy-Mask-Types", result.maskSummary.categories.join(","));
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
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
