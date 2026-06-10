import { describe, it, expect } from "vitest";
import { scanSecrets } from "@/scanner/secrets";

describe("scanSecrets — mask rules", () => {
  it("detects RSA private key (full block)", () => {
    const text =
      'config = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowI...\n-----END RSA PRIVATE KEY-----"';
    const f = scanSecrets(text);
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe("PRIVATE_KEY");
    expect(f[0].action).toBe("mask");
    expect(f[0].maskTag).toBe("[PRIVATE_KEY]");
    expect(f[0].matched).toContain("-----BEGIN RSA PRIVATE KEY-----");
    expect(f[0].matched).toContain("-----END RSA PRIVATE KEY-----");
  });

  it("detects OpenSSH private key (full block)", () => {
    const text =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----";
    const f = scanSecrets(text);
    expect(f[0].category).toBe("PRIVATE_KEY");
    expect(f[0].matched).toContain("-----BEGIN OPENSSH PRIVATE KEY-----");
    expect(f[0].matched).toContain("-----END OPENSSH PRIVATE KEY-----");
  });

  it("detects EC private key (full block)", () => {
    const text =
      "-----BEGIN EC PRIVATE KEY-----\nabc\n-----END EC PRIVATE KEY-----";
    const f = scanSecrets(text);
    expect(f[0].category).toBe("PRIVATE_KEY");
    expect(f[0].matched).toContain("-----BEGIN EC PRIVATE KEY-----");
    expect(f[0].matched).toContain("-----END EC PRIVATE KEY-----");
  });

  it("detects Bearer token", () => {
    const f = scanSecrets(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"
    );
    expect(f).toContainEqual(
      expect.objectContaining({
        category: "BEARER_TOKEN",
        action: "mask",
        maskTag: "[BEARER_TOKEN]",
      })
    );
  });

  it("detects Basic auth", () => {
    const f = scanSecrets("Authorization: Basic dXNlcjpwYXNz");
    expect(f[0].category).toBe("BASIC_AUTH");
    expect(f[0].action).toBe("mask");
    expect(f[0].maskTag).toBe("[BASIC_AUTH]");
    expect(f[0].matched).toBe("Basic dXNlcjpwYXNz");
  });

  it("detects JWT (eyJ...)", () => {
    const f = scanSecrets(
      "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def"
    );
    expect(f).toContainEqual(
      expect.objectContaining({ category: "JWT", maskTag: "[JWT]" })
    );
  });

  it("detects Cookie header", () => {
    const f = scanSecrets("Cookie: session=abc123");
    expect(f[0].category).toBe("COOKIE_HEADER");
    expect(f[0].action).toBe("mask");
    expect(f[0].maskTag).toBe("[COOKIE_HEADER]");
    expect(f[0].matched).toBe("Cookie: session=abc123");
  });

  it("detects Set-Cookie header", () => {
    const f = scanSecrets("Set-Cookie: sid=xyz");
    expect(f[0].category).toBe("SET_COOKIE_HEADER");
    expect(f[0].maskTag).toBe("[SET_COOKIE_HEADER]");
    expect(f[0].matched).toBe("Set-Cookie: sid=xyz");
  });

  it("detects PostgreSQL URI", () => {
    const f = scanSecrets("postgres://user:pass@db.example.com:5432/mydb");
    expect(f[0].category).toBe("DB_URI");
    expect(f[0].maskTag).toBe("[DB_URI]");
  });

  it("detects MySQL URI", () => {
    const f = scanSecrets("mysql://root:secret@localhost:3306/db");
    expect(f[0].category).toBe("DB_URI");
  });

  it("detects MongoDB URI", () => {
    const f = scanSecrets(
      "mongodb://admin:password@cluster.mongodb.net/test"
    );
    expect(f[0].category).toBe("DB_URI");
  });

  it("detects Redis URI", () => {
    const f = scanSecrets("redis://default:redispass@redis.example.com:6379");
    expect(f[0].category).toBe("DB_URI");
  });

  it("detects AWS access key", () => {
    const f = scanSecrets("aws_access_key_id = AKIAIOSFODNN7EXAMPLE");
    expect(f[0].category).toBe("AWS_ACCESS_KEY");
    expect(f[0].maskTag).toBe("[AWS_ACCESS_KEY]");
    expect(f[0].matched).toBe("AKIAIOSFODNN7EXAMPLE");
  });

  it("detects AWS ASIA key", () => {
    const f = scanSecrets("key=ASIAIOSFODNN7EXAMPLE1");
    expect(f[0].category).toBe("AWS_ACCESS_KEY");
  });

  it("detects GitHub PAT", () => {
    const f = scanSecrets("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij");
    expect(f[0].category).toBe("GITHUB_TOKEN");
    expect(f[0].maskTag).toBe("[GITHUB_TOKEN]");
  });

  it("detects GitHub fine-grained PAT", () => {
    const f = scanSecrets(
      "github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij123456"
    );
    expect(f[0].category).toBe("GITHUB_TOKEN");
  });

  it("detects Slack bot token (xoxb)", () => {
    const f = scanSecrets("xoxb-1234567890-abcdefghijk");
    expect(f[0].category).toBe("SLACK_TOKEN");
    expect(f[0].maskTag).toBe("[SLACK_TOKEN]");
  });

  it("detects Slack user token (xoxp)", () => {
    const f = scanSecrets("xoxp-1234567890-abcdefghijk");
    expect(f[0].category).toBe("SLACK_TOKEN");
  });

  it("detects Google API key", () => {
    const f = scanSecrets("AIzaSyA1234567890abcdefghijklmnopqrstuvwx");
    expect(f[0].category).toBe("GOOGLE_API_KEY");
    expect(f[0].maskTag).toBe("[GOOGLE_API_KEY]");
  });

  it("returns empty for clean text", () => {
    const f = scanSecrets(
      "Hello, this is a normal message without secrets."
    );
    expect(f).toHaveLength(0);
  });

  it("returns multiple findings for multi-secret text", () => {
    const text = `
      key1: Bearer abc123token
      key2: postgres://u:p@host/db
    `;
    const f = scanSecrets(text);
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(f.every((x) => x.action === "mask")).toBe(true);
  });

  it("stores actual matched text for masking", () => {
    const text = "Authorization: Bearer abc123token";
    const f = scanSecrets(text);
    expect(f[0].matched).toBe("Bearer abc123token");
  });

  it("all findings have action mask", () => {
    const text = "Bearer abc123token postgres://u:p@host/db";
    const f = scanSecrets(text);
    for (const finding of f) {
      expect(finding.action).toBe("mask");
    }
  });
});
