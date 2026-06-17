import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { statSync, unlinkSync } from "fs";

const TEST_PORT = 9876;
const TEST_DB = "./test-integration-audit.sqlite";
const ADMIN_KEY = "test-integration-key";
const UPSTREAM_URL = "http://httpbin.org";

describe("Integration: Privacy Proxy + Dashboard", () => {
  let serverProcess: ChildProcess | null = null;

  beforeAll(async () => {
    try {
      unlinkSync(TEST_DB);
    } catch {}

    serverProcess = spawn("npm", ["run", "dev"], {
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

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Server start timeout")), 30000);
      
      serverProcess!.stdout?.on("data", (data: Buffer) => {
        if (data.toString().includes("Ready")) {
          clearTimeout(timeout);
          resolve();
        }
      });

      serverProcess!.stderr?.on("data", (data: Buffer) => {
        console.error("Server stderr:", data.toString());
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }, 40000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });

  it("allows clean request and records audit log", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello world", number: 42 }),
    });

    expect(res.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const stat = statSync(TEST_DB);
    expect(stat.size).toBeGreaterThan(0);
  }, 20000);

  it("masks sensitive token and records as mask action", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        auth: "Bearer sk-1234567890abcdefghijklmnopqrstuvwxyz"
      }),
    });

    expect(res.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }, 20000);

  it("dashboard API returns audit records with auth", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/admin/audit?limit=10`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("rows");
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.total).toBeGreaterThanOrEqual(2);

    const allowRecord = data.rows.find((r: any) => r.action === "allow");
    expect(allowRecord).toBeDefined();

    const maskRecord = data.rows.find((r: any) => r.action === "mask");
    expect(maskRecord).toBeDefined();
    expect(maskRecord.findings.length).toBeGreaterThan(0);
  }, 15000);

  it("dashboard API rejects without auth", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/admin/audit?limit=10`);
    expect(res.status).toBe(401);
  });

  it("dashboard config API returns runtime env", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/admin/config`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.env).toBeDefined();
    expect(data.env.upstreamUrl).toBe(UPSTREAM_URL);
    expect(data.env.dbPath).toBe(TEST_DB);
    expect(data.env.port).toBe(String(TEST_PORT));
    expect(data.dbStats).toBeDefined();
    expect(data.dbStats.totalRecords).toBeGreaterThanOrEqual(2);
  }, 15000);

  it("dashboard stats API returns correct counts", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/admin/stats`, {
      headers: { "x-admin-key": ADMIN_KEY },
    });

    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(stats.total).toBeGreaterThanOrEqual(2);
    expect(stats.masked).toBeGreaterThanOrEqual(1);
    expect(stats.allowed).toBeGreaterThanOrEqual(1);
  }, 15000);
});
