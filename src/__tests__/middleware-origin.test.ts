import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

function request(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, { headers });
}

const ENV_KEYS = ["DISABLE_ORIGIN_CHECK", "ALLOWED_ORIGINS", "TRUST_PROXY"] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("admin origin check (R6)", () => {
  it("passes through when no Origin/Referer header (non-browser clients)", () => {
    const res = middleware(request("/api/admin/stats"));
    expect(res.status).not.toBe(403);
  });

  it("allows same-origin requests", () => {
    const res = middleware(request("/api/admin/stats", { origin: "http://localhost:3000" }));
    expect(res.status).not.toBe(403);
  });

  it("rejects cross-origin requests with 403", () => {
    const res = middleware(request("/api/admin/stats", { origin: "https://evil.example.com" }));
    expect(res.status).toBe(403);
  });

  it("rejects Origin: null (sandboxed)", () => {
    const res = middleware(request("/api/admin/stats", { origin: "null" }));
    expect(res.status).toBe(403);
  });

  it("honors ALLOWED_ORIGINS extra entries", () => {
    process.env.ALLOWED_ORIGINS = "https://admin.example.com, https://alt.example.com/";
    const res = middleware(request("/api/admin/stats", { origin: "https://admin.example.com" }));
    expect(res.status).not.toBe(403);
  });

  it("TRUST_PROXY=1 accepts forwarded proto/host as the deployment origin", () => {
    process.env.TRUST_PROXY = "1";
    const res = middleware(
      request("/api/admin/stats", {
        origin: "https://mask.example.com",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "mask.example.com",
      })
    );
    expect(res.status).not.toBe(403);
  });

  it("DISABLE_ORIGIN_CHECK=1 disables the check entirely", () => {
    process.env.DISABLE_ORIGIN_CHECK = "1";
    const res = middleware(request("/api/admin/stats", { origin: "https://evil.example.com" }));
    expect(res.status).not.toBe(403);
  });
});
