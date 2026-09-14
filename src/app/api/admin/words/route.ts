import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/admin-auth";
import { bulkCreateWords, createWord, deleteWord, listWords, updateWord, validateRegex } from "@/words/store";
import { Logger } from "@/log";

const log = new Logger("admin");

const MAX_VALUE_LEN = 200;
const MAX_LABEL_LEN = 40;

interface ParsedWord {
  label: string;
  value: string;
  kind: "word" | "regex";
  wholeWord: boolean;
  enabled: boolean;
}

function parseWordInput(raw: unknown): ParsedWord | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "invalid_body" };
  const body = raw as Record<string, unknown>;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const value = typeof body.value === "string" ? body.value.trim() : "";
  const kind = body.kind === "regex" ? "regex" : body.kind === "word" ? "word" : null;
  if (!label || label.length > MAX_LABEL_LEN) return { error: "invalid_label" };
  if (!value || value.length > MAX_VALUE_LEN) return { error: "invalid_value" };
  if (!kind) return { error: "invalid_kind" };
  if (kind === "regex" && !validateRegex(value)) return { error: "invalid_regex" };
  return {
    label,
    value,
    kind,
    wholeWord: body.wholeWord === true,
    enabled: body.enabled !== false,
  };
}

export async function GET(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    return NextResponse.json({ rows: listWords() });
  } catch (err) {
    log.error(`words GET failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();

    // 批量导入(.env 导入走这里):{ items: [...] }
    if (Array.isArray(body?.items)) {
      const parsed: ParsedWord[] = [];
      for (const item of body.items) {
        const result = parseWordInput(item);
        if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
        parsed.push(result);
      }
      const created = bulkCreateWords(parsed);
      return NextResponse.json({ created }, { status: 201 });
    }

    const result = parseWordInput(body);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const created = createWord(result);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    log.error(`words POST failed: ${err instanceof Error ? err.message : String(err)}`);
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
    const patch: Parameters<typeof updateWord>[1] = {};
    if (body.label !== undefined) {
      const label = typeof body.label === "string" ? body.label.trim() : "";
      if (!label || label.length > MAX_LABEL_LEN) return NextResponse.json({ error: "invalid_label" }, { status: 400 });
      patch.label = label;
    }
    if (body.value !== undefined) {
      const value = typeof body.value === "string" ? body.value.trim() : "";
      if (!value || value.length > MAX_VALUE_LEN) return NextResponse.json({ error: "invalid_value" }, { status: 400 });
      if ((body.kind ?? "word") === "regex" && !validateRegex(value)) {
        return NextResponse.json({ error: "invalid_regex" }, { status: 400 });
      }
      patch.value = value;
    }
    if (body.kind !== undefined) {
      if (body.kind !== "word" && body.kind !== "regex") {
        return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
      }
      patch.kind = body.kind;
    }
    if (body.wholeWord !== undefined) patch.wholeWord = body.wholeWord === true;
    if (body.enabled !== undefined) patch.enabled = body.enabled === true;

    const updated = updateWord(id, patch);
    if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    log.error(`words PUT failed: ${err instanceof Error ? err.message : String(err)}`);
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
    const deleted = deleteWord(id);
    if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    log.error(`words DELETE failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
