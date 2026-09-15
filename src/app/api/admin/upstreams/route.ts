import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/admin-auth";
import { createUpstream, deleteUpstream, getUpstreamByName, listUpstreams, updateUpstream } from "@/upstreams/store";
import { CHANNEL_NAME_RE, EXTRA_HEADER_BLACKLIST, RESERVED_CHANNEL_SEGMENTS } from "@/proxy/channels";
import { Logger } from "@/log";

const log = new Logger("admin");

interface ParsedUpstream {
  name: string;
  target: string;
  extraHeaders: Record<string, string>;
  enabled: boolean;
}

function normalizeTarget(raw: unknown): string | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { error: "invalid_target" };
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "invalid_target_protocol" };
    if (url.search || url.hash) return { error: "invalid_target" };
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return { error: "invalid_target" };
  }
}

function parseExtraHeaders(raw: unknown): Record<string, string> | { error: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "invalid_extra_headers" };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") return { error: "invalid_extra_headers" };
    if (EXTRA_HEADER_BLACKLIST.has(key.toLowerCase())) return { error: `extra_header_forbidden:${key.toLowerCase()}` };
    out[key] = value;
  }
  return out;
}

function parseUpstreamInput(raw: unknown, { requireAll }: { requireAll: boolean }): ParsedUpstream | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "invalid_body" };
  const body = raw as Record<string, unknown>;

  let name: string | undefined;
  if (body.name !== undefined || requireAll) {
    const candidate = typeof body.name === "string" ? body.name.trim().toLowerCase() : "";
    if (!CHANNEL_NAME_RE.test(candidate)) return { error: "invalid_name" };
    if (RESERVED_CHANNEL_SEGMENTS.has(candidate)) return { error: "reserved_name" };
    name = candidate;
  }

  let target: string | undefined;
  if (body.target !== undefined || requireAll) {
    const normalized = normalizeTarget(body.target);
    if (typeof normalized !== "string") return normalized;
    target = normalized;
  }

  let extraHeaders: Record<string, string> | undefined;
  if (body.extraHeaders !== undefined || requireAll) {
    const parsedHeaders = parseExtraHeaders(body.extraHeaders);
    if ("error" in parsedHeaders) {
      return { error: String((parsedHeaders as { error: string }).error) };
    }
    extraHeaders = parsedHeaders as Record<string, string>;
  }

  return {
    name: name ?? "",
    target: target ?? "",
    extraHeaders: extraHeaders ?? {},
    enabled: body.enabled !== false,
  };
}

export async function GET(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    return NextResponse.json({ rows: listUpstreams() });
  } catch (err) {
    log.error(`upstreams GET failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const parsed = parseUpstreamInput(await request.json(), { requireAll: true });
    if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });
    if (getUpstreamByName(parsed.name)) {
      return NextResponse.json({ error: "name_taken" }, { status: 409 });
    }
    const created = createUpstream(parsed);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    log.error(`upstreams POST failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid_id" }, { status: 400 });
    }
    const parsed = parseUpstreamInput(body, { requireAll: false });
    if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });

    const patch: Parameters<typeof updateUpstream>[1] = {};
    if (parsed.name) {
      const existing = getUpstreamByName(parsed.name);
      if (existing && existing.id !== id) return NextResponse.json({ error: "name_taken" }, { status: 409 });
      patch.name = parsed.name;
    }
    if (parsed.target) patch.target = parsed.target;
    if (body.extraHeaders !== undefined) patch.extraHeaders = parsed.extraHeaders;
    if (body.enabled !== undefined) patch.enabled = body.enabled === true;

    const updated = updateUpstream(id, patch);
    if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    log.error(`upstreams PUT failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid_id" }, { status: 400 });
    }
    if (!deleteUpstream(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    log.error(`upstreams DELETE failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
