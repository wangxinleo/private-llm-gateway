import { describe, it, expect, beforeAll, afterAll, type TestContext } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import http from "node:http";
import { statSync, unlinkSync } from "fs";

const TEST_HOST = "127.0.0.1";
const TEST_PORT = 9876;
const UPSTREAM_PORT = 9877;
const TEST_DB = "./test-integration-audit.sqlite";
const ADMIN_KEY = "test-integration-key";
const TEST_BASE_URL = `http://${TEST_HOST}:${TEST_PORT}`;
const UPSTREAM_URL = `http://${TEST_HOST}:${UPSTREAM_PORT}`;

interface AuditApiRow {
  action: string;
  findings: string[];
}

interface AuditApiResponse {
  rows: AuditApiRow[];
  total: number;
}

interface ConfigApiResponse {
  env?: {
    upstreamUrl: string;
    dbPath: string;
    port: string;
  };
  dbStats?: {
    totalRecords: number;
  };
}

interface StatsApiResponse {
  total: number;
  masked: number;
  allowed: number;
}

function removeTestDb(): void {
  try {
    unlinkSync(TEST_DB);
  } catch {}
}

function getErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isListenPermissionError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code === "EPERM" || code === "EACCES") return true;
  if (!(error instanceof Error)) return false;
  return /\b(listen|bind)\b.*\b(EPERM|EACCES)\b|\b(EPERM|EACCES)\b.*\b(listen|bind)\b/.test(error.message);
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, TEST_HOST);
  });
}

function waitForDevServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const onStdout = (data: Buffer) => {
      if (data.toString().includes("Ready")) {
        cleanup();
        resolve();
      }
    };
    const onStderr = (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      console.error("Server stderr:", text);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`Server exited before ready (code=${code ?? "null"}, signal=${signal ?? "null"}): ${stderr.trim()}`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Server start timeout: ${stderr.trim()}`));
    }, 30000);

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

describe("Integration: Privacy Proxy + Dashboard", () => {
  let serverProcess: ChildProcess | null = null;
  let upstream: http.Server | null = null;
  let skipReason: string | null = null;

  function skipIfUnavailable(context: TestContext): void {
    if (skipReason) context.skip(skipReason);
  }

  beforeAll(async () => {
    removeTestDb();

    const upstreamServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("X-Received-Method", req.method ?? "");
        res.setHeader("X-Received-Path", req.url ?? "/");
        res.end(JSON.stringify({ method: req.method, path: req.url, body }));
      });
    });

    try {
      await listen(upstreamServer, UPSTREAM_PORT);
    } catch (error) {
      if (isListenPermissionError(error)) {
        skipReason = `listen is not permitted on ${TEST_HOST}:${UPSTREAM_PORT} in this environment`;
        upstreamServer.close();
        return;
      }
      throw error;
    }

    upstream = upstreamServer;

    const child = spawn("npm", ["run", "dev", "--", "--hostname", TEST_HOST], {
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        ADMIN_KEY,
        UPSTREAM_URL,
        DB_PATH: TEST_DB,
        NODE_ENV: "development",
      },
      stdio: "pipe",
    });
    serverProcess = child;

    try {
      await waitForDevServer(child);
    } catch (error) {
      if (isListenPermissionError(error)) {
        skipReason = `listen is not permitted on ${TEST_HOST}:${TEST_PORT} in this environment`;
        child.kill("SIGTERM");
        return;
      }
      throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }, 40000);

  afterAll(async () => {
    const child = serverProcess;
    if (child) {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const upstreamServer = upstream;
    if (upstreamServer?.listening) {
      await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
    }

    removeTestDb();
  });

  it("allows clean request and records audit log", async (context) => {
    skipIfUnavailable(context);

    const res = await fetch(`${TEST_BASE_URL}/api/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello world", number: 42 }),
    });

    expect(res.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const stat = statSync(TEST_DB);
    expect(stat.size).toBeGreaterThan(0);
  }, 20000);

  it("masks sensitive token and records as mask action", async (context) => {
    skipIfUnavailable(context);

    const res = await fetch(`${TEST_BASE_URL}/api/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth: "Bearer abc123token",
      }),
    });

    expect(res.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }, 20000);

  it("dashboard API returns audit records with auth", async (context) => {
    skipIfUnavailable(context);

    const res = await fetch(`${TEST_BASE_URL}/api/admin/audit?limit=10`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });

    expect(res.status).toBe(200);
    const data = await res.json() as AuditApiResponse;
    expect(data).toHaveProperty("rows");
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.total).toBeGreaterThanOrEqual(2);

    const allowRecord = data.rows.find((row) => row.action === "allow");
    expect(allowRecord).toBeDefined();

    const maskRecord = data.rows.find((row) => row.action === "mask");
    expect(maskRecord).toBeDefined();
    expect(maskRecord?.findings.length).toBeGreaterThan(0);
  }, 15000);

  it("dashboard API rejects without auth", async (context) => {
    skipIfUnavailable(context);

    const res = await fetch(`${TEST_BASE_URL}/api/admin/audit?limit=10`);
    expect(res.status).toBe(401);
  });

  it("dashboard config API returns runtime env", async (context) => {
    skipIfUnavailable(context);

    const res = await fetch(`${TEST_BASE_URL}/api/admin/config`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });

    expect(res.status).toBe(200);
    const data = await res.json() as ConfigApiResponse;
    expect(data.env).toBeDefined();
    expect(data.env?.upstreamUrl).toBe(UPSTREAM_URL);
    expect(data.env?.dbPath).toBe(TEST_DB);
    expect(data.env?.port).toBe(String(TEST_PORT));
    expect(data.dbStats).toBeDefined();
    expect(data.dbStats?.totalRecords).toBeGreaterThanOrEqual(2);
  }, 15000);

  it("dashboard stats API returns correct counts", async (context) => {
    skipIfUnavailable(context);

    const res = await fetch(`${TEST_BASE_URL}/api/admin/stats`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });

    expect(res.status).toBe(200);
    const stats = await res.json() as StatsApiResponse;
    expect(stats.total).toBeGreaterThanOrEqual(2);
    expect(stats.masked).toBeGreaterThanOrEqual(1);
    expect(stats.allowed).toBeGreaterThanOrEqual(1);
  }, 15000);
});
