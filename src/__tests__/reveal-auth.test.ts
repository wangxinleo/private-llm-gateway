import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/reveal-auth/route";
import {
  REVEAL_MAX_AGE,
  checkRevealAuth,
  cleanupExpiredTokens,
  getRevealExpiry,
  revealTokens,
} from "@/app/api/admin/reveal-auth/auth";

describe("reveal auth route and helpers", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ADMIN_KEY;
    process.env.ADMIN_KEY = "test-key";
    revealTokens.clear();
  });

  afterEach(() => {
    process.env.ADMIN_KEY = originalKey;
    revealTokens.clear();
    vi.restoreAllMocks();
  });

  it("returns 503 when ADMIN_KEY is not set", async () => {
    delete process.env.ADMIN_KEY;
    const req = new Request("http://localhost:3000/api/admin/reveal-auth", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": "test-key" },
      body: JSON.stringify({ password: "test-key" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "admin_not_configured" });
  });

  it("returns 401 when x-admin-key does not match", async () => {
    const req = new Request("http://localhost:3000/api/admin/reveal-auth", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": "wrong" },
      body: JSON.stringify({ password: "test-key" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 when password does not match", async () => {
    const req = new Request("http://localhost:3000/api/admin/reveal-auth", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": "test-key" },
      body: JSON.stringify({ password: "wrong" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("issues reveal cookie and stores token for 30 minutes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const req = new Request("http://localhost:3000/api/admin/reveal-auth", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": "test-key" },
      body: JSON.stringify({ password: "test-key" }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({
      expiresAt: new Date(getRevealExpiry(1_700_000_000_000)).toISOString(),
    });

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("reveal_token=");
    expect(setCookie).toContain(`Max-Age=${REVEAL_MAX_AGE}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/api/admin");

    const token = setCookie?.match(/reveal_token=([^;]+)/)?.[1];
    expect(token).toBeTruthy();
    expect(revealTokens.get(token!)).toBe(getRevealExpiry(1_700_000_000_000));
  });

  it("checkRevealAuth returns false without cookie", () => {
    const req = new Request("http://localhost:3000/api/admin/audit");
    expect(checkRevealAuth(req)).toBe(false);
  });

  it("checkRevealAuth returns true for valid unexpired token cookie", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    revealTokens.set("token-1", 1_700_000_000_000 + 60_000);
    const req = new Request("http://localhost:3000/api/admin/audit", {
      headers: { cookie: "reveal_token=token-1" },
    });
    expect(checkRevealAuth(req)).toBe(true);
  });

  it("checkRevealAuth returns false for expired token and cleanup removes it", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    revealTokens.set("expired-token", 1_699_999_999_000);
    const req = new Request("http://localhost:3000/api/admin/audit", {
      headers: { cookie: "reveal_token=expired-token" },
    });
    expect(checkRevealAuth(req)).toBe(false);
    expect(revealTokens.has("expired-token")).toBe(false);
  });

  it("cleanupExpiredTokens removes only expired entries", () => {
    revealTokens.set("expired", 100);
    revealTokens.set("active", 200);
    cleanupExpiredTokens(150);
    expect(revealTokens.has("expired")).toBe(false);
    expect(revealTokens.has("active")).toBe(true);
  });
});
