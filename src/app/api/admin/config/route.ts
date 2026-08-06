import { NextResponse } from "next/server";
import { getDbStats, getAllConfigs, setConfig } from "@/audit";
import { checkAdminAuth } from "@/lib/admin-auth";
import { UPSTREAM_URL, DB_PATH, DEBUG, CONTEXT_KEY, PATH_PREFIX_OPTIONS, HIGH_RISK_ASSETS } from "@/config";
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
        context_key_min_length: { value: CONTEXT_KEY.MIN_LENGTH, type: "number", description: "Context key minimum length" },
        context_key_max_length: { value: CONTEXT_KEY.MAX_LENGTH, type: "number", description: "Context key maximum length" },
        context_key_max_spaces: { value: CONTEXT_KEY.MAX_SPACES, type: "number", description: "Context key maximum spaces" },
        high_risk_assets: { value: HIGH_RISK_ASSETS, type: "json_array", description: "High-risk asset whitelist (domains/emails/accounts) whose context windows are scanned" },
      },
      constants: {
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
      "context_key_min_length",
      "context_key_max_length",
      "context_key_max_spaces",
      "high_risk_assets",
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
    } else if (key === "high_risk_assets") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return NextResponse.json({ error: "high_risk_assets must be an object" }, { status: 400 });
      }
      const { domains, emails, accounts } = value as Record<string, unknown>;
      for (const [field, arr] of [["domains", domains], ["emails", emails], ["accounts", accounts]] as const) {
        if (arr !== undefined && (!Array.isArray(arr) || !arr.every(v => typeof v === "string"))) {
          return NextResponse.json({ error: `high_risk_assets.${field} must be an array of strings` }, { status: 400 });
        }
      }
      type = "json_array";
      valueStr = JSON.stringify({
        domains: Array.isArray(domains) ? domains : [],
        emails: Array.isArray(emails) ? emails : [],
        accounts: Array.isArray(accounts) ? accounts : [],
      });
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
