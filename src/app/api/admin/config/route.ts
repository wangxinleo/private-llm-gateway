import { NextResponse } from "next/server";
import { getDbStats } from "@/audit";
import { checkAdminAuth } from "@/lib/admin-auth";
import { DB_PATH, DEBUG, SIZE_THRESHOLDS, CHUNK_SIZE, CONTEXT_KEY } from "@/config";
import { Logger } from "@/log";
import { statSync } from "fs";

const log = new Logger("admin");

export async function GET(request: Request) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
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
        debug: DEBUG,
        nodeEnv: process.env.NODE_ENV ?? "development",
        port: process.env.PORT ?? "3000",
      },
      constants: {
        sizeThresholds: {
          fullScan: SIZE_THRESHOLDS.FULL_SCAN,
          chunkedScan: SIZE_THRESHOLDS.CHUNKED_SCAN,
        },
        chunkSize: CHUNK_SIZE,
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
