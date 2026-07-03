import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkAdminAuth } from "@/lib/admin-auth";

describe("checkAdminAuth", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ADMIN_KEY;
  });

  afterEach(() => {
    process.env.ADMIN_KEY = originalKey;
  });

  it("returns 503 when ADMIN_KEY is not set", async () => {
    delete process.env.ADMIN_KEY;
    const req = new Request("http://localhost/test");
    const res = checkAdminAuth(req);
    if (!res) throw new Error("expected admin_not_configured response");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "admin_not_configured" });
  });

  it("returns 401 when x-admin-key does not match", async () => {
    process.env.ADMIN_KEY = "test-secret";
    const req = new Request("http://localhost/test", {
      headers: { "x-admin-key": "wrong" },
    });
    const res = checkAdminAuth(req);
    if (!res) throw new Error("expected unauthorized response");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns null when x-admin-key matches", () => {
    process.env.ADMIN_KEY = "test-secret";
    const req = new Request("http://localhost/test", {
      headers: { "x-admin-key": "test-secret" },
    });
    expect(checkAdminAuth(req)).toBeNull();
  });

  it("does not accept admin keys from query parameters", async () => {
    process.env.ADMIN_KEY = "test-secret";
    const req = new Request("http://localhost/test?key=test-secret");
    const res = checkAdminAuth(req);
    if (!res) throw new Error("expected unauthorized response");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("uses only x-admin-key even when a matching query key is present", async () => {
    process.env.ADMIN_KEY = "test-secret";
    const req = new Request("http://localhost/test?key=test-secret", {
      headers: { "x-admin-key": "wrong" },
    });
    const res = checkAdminAuth(req);
    if (!res) throw new Error("expected unauthorized response");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 when x-admin-key header is missing", async () => {
    process.env.ADMIN_KEY = "test-secret";
    const req = new Request("http://localhost/test");
    const res = checkAdminAuth(req);
    if (!res) throw new Error("expected unauthorized response");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
