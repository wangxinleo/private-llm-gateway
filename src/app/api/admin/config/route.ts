import { NextResponse } from "next/server";
import { getDbStats, getAllConfigs, setConfig } from "@/audit";
import { checkAdminAuth } from "@/lib/admin-auth";
import { UPSTREAM_URL, DB_PATH, DEBUG, SIZE_THRESHOLDS, CONFIG_STATE, CONTEXT_KEY, PATH_PREFIX_OPTIONS, SCANNER_EXCLUSIONS } from "@/config";
import { initializeConfigs, refreshConfig } from "@/config-loader";
import { Logger } from "@/log";
import { statSync } from "fs";

const log = new Logger("admin");

export async function GET(request: Request) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    // Ensure configs are loaded from database
    initializeConfigs();

    const dbStats = getDbStats();
    let dbFileSize = 0;
    try {
      const stat = statSync(DB_PATH);
      dbFileSize = stat.size;
    } catch {
      // DB file might not exist yet
    }

    return NextResponse.json({
      env: {
        upstreamUrl: UPSTREAM_URL,
        dbPath: DB_PATH,
        debug: DEBUG,
        nodeEnv: process.env.NODE_ENV ?? "development",
        port: process.env.PORT ?? "3000",
      },
      editableConfigs: {
        path_prefix_options: { value: PATH_PREFIX_OPTIONS, type: "json_array", description: "Path prefix options for bypass rules" },
        size_threshold_full_scan: { value: SIZE_THRESHOLDS.FULL_SCAN, type: "number", description: "Full scan threshold in bytes" },
        size_threshold_chunked_scan: { value: SIZE_THRESHOLDS.CHUNKED_SCAN, type: "number", description: "Chunked scan threshold in bytes" },
        chunk_size: { value: CONFIG_STATE.CHUNK_SIZE, type: "number", description: "Chunk size in bytes" },
        context_key_min_length: { value: CONTEXT_KEY.MIN_LENGTH, type: "number", description: "Context key minimum length" },
        context_key_max_length: { value: CONTEXT_KEY.MAX_LENGTH, type: "number", description: "Context key maximum length" },
        context_key_max_spaces: { value: CONTEXT_KEY.MAX_SPACES, type: "number", description: "Context key maximum spaces" },
        scanner_exclusions: { value: SCANNER_EXCLUSIONS, type: "json_array", description: "Scanner exclusion rules (false positive suppression)" },
      },
      constants: {
        sizeThresholds: {
          fullScan: SIZE_THRESHOLDS.FULL_SCAN,
          chunkedScan: SIZE_THRESHOLDS.CHUNKED_SCAN,
        },
        chunkSize: CONFIG_STATE.CHUNK_SIZE,
        contextKey: {
          minLength: CONTEXT_KEY.MIN_LENGTH,
          maxLength: CONTEXT_KEY.MAX_LENGTH,
          maxSpaces: CONTEXT_KEY.MAX_SPACES,
        },
      },
      dbStats: {
        totalRecords: dbStats.totalRecords,
        earliestRecord: dbStats.earliestRecord,
        latestRecord: dbStats.latestRecord,
        dbFileSize,
      },
    });
  } catch (err) {
    log.error(`config GET failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { key, value } = body;

    if (!key || value === undefined) {
      return NextResponse.json({ error: "key and value are required" }, { status: 400 });
    }

    // Validate key is editable
    const editableKeys = [
      "path_prefix_options",
      "size_threshold_full_scan",
      "size_threshold_chunked_scan",
      "chunk_size",
      "context_key_min_length",
      "context_key_max_length",
      "context_key_max_spaces",
      "scanner_exclusions",
    ];

    if (!editableKeys.includes(key)) {
      return NextResponse.json({ error: "config key is not editable" }, { status: 400 });
    }

    // Validate and save based on type
    let type: 'number' | 'string' | 'json_array';
    let valueStr: string;

    if (key === "path_prefix_options") {
      if (!Array.isArray(value)) {
        return NextResponse.json({ error: "path_prefix_options must be an array" }, { status: 400 });
      }
      if (!value.every(v => typeof v === 'string' && v.startsWith('/'))) {
        return NextResponse.json({ error: "path prefixes must be strings starting with /" }, { status: 400 });
      }
      type = "json_array";
      valueStr = JSON.stringify(value);
    } else if (key === "scanner_exclusions") {
      if (!Array.isArray(value)) {
        return NextResponse.json({ error: "scanner_exclusions must be an array" }, { status: 400 });
      }
      for (const rule of value) {
        if (!rule || typeof rule !== "object" ||
            typeof rule.category !== "string" ||
            (rule.mode !== "exact" && rule.mode !== "regex") ||
            typeof rule.value !== "string") {
          return NextResponse.json({ error: "each exclusion rule must have { category, mode: 'exact'|'regex', value }" }, { status: 400 });
        }
        if (rule.mode === "regex") {
          try { new RegExp(rule.value); } catch {
            return NextResponse.json({ error: `invalid regex: ${rule.value}` }, { status: 400 });
          }
        }
      }
      type = "json_array";
      valueStr = JSON.stringify(value);
    } else {
      // Number configs
      const numValue = Number(value);
      if (isNaN(numValue) || numValue < 0) {
        return NextResponse.json({ error: "value must be a positive number" }, { status: 400 });
      }
      type = "number";
      valueStr = String(numValue);
    }

    // Save to database
    setConfig(key, valueStr, type);

    // Refresh in-memory config
    refreshConfig(key);

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error(`config PUT failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}
