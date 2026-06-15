import { NextRequest } from "next/server";
import { runPipeline } from "@/scanner/pipeline";
import { isJsonContentType, maskJsonBody } from "@/scanner/json-mask";
import { parseMultipart, collectMultipartText, collectFilenames } from "@/scanner/multipart";
import { blockedResponse } from "@/engine/policy";
import { forwardRequest } from "@/proxy/forwarder";
import { createStreamingResponse } from "@/proxy/streaming";
import { logAudit } from "@/audit/logger";
import { DEBUG } from "@/config";

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

  const hasBody = method !== "GET" && method !== "HEAD";
  let bodyText = "";
  let filenames: string[] = [];
  let bodySize = 0;

  if (hasBody) {
    const extracted = await extractBodyText(request);
    bodyText = extracted.text;
    filenames = extracted.filenames;
    bodySize = extracted.size;
  }

  if (DEBUG) {
    console.log(`[proxy] ${method} ${path} | contentType: ${contentType} | bodySize: ${bodySize}`);
  }

  const scanFn = (text: string, size: number) => runPipeline(text, size, filenames);
  const result = isJsonContentType(contentType) && !isMultipart(contentType)
    ? maskJsonBody(bodyText, scanFn)
    : runPipeline(bodyText, bodySize, filenames);

  const hitCategories = result.findings.map(f => f.category).join(", ");
  const duration = (performance.now() - startTime).toFixed(2);

  if (result.action !== "allow" || DEBUG) {
    console.log(`[proxy] ${method} ${path} | action: ${result.action} | hits: ${hitCategories || "none"} | ${duration}ms`);
  }

  logAudit({
    path,
    method,
    contentType,
    bodySize,
    filenames,
    findings: result.findings,
    action: result.action,
  });

  if (result.action === "block") {
    const blocked = blockedResponse(result.findings);
    return Response.json(blocked.body, { status: blocked.status });
  }

  const upstream = await forwardRequest(
    path,
    request,
    result.action === "mask" ? result.maskedBody : hasBody ? bodyText : undefined
  );

  const upstreamContentType = upstream.headers.get("content-type") ?? "";
  if (upstreamContentType.includes("text/event-stream")) {
    return createStreamingResponse(upstream);
  }

  return upstream;
}
