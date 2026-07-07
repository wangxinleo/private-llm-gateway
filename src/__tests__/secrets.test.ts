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
    expect(f[0].maskTag).toBe("<<PRIVACY_MASK:PRIVATE_KEY>>");
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
        maskTag: "<<PRIVACY_MASK:BEARER_TOKEN>>",
      })
    );
  });

  it("detects Basic auth", () => {
    const f = scanSecrets("Authorization: Basic dXNlcjpwYXNz");
    expect(f[0].category).toBe("BASIC_AUTH");
    expect(f[0].action).toBe("mask");
    expect(f[0].maskTag).toBe("<<PRIVACY_MASK:BASIC_AUTH>>");
    expect(f[0].matched).toBe("Basic dXNlcjpwYXNz");
  });

  it("detects JWT (eyJ...)", () => {
    const f = scanSecrets(
      "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def"
    );
    expect(f).toContainEqual(
      expect.objectContaining({ category: "JWT", maskTag: "<<PRIVACY_MASK:JWT>>" })
    );
  });

  it("detects Cookie header", () => {
    const f = scanSecrets("Cookie: session=abc123");
    expect(f[0].category).toBe("COOKIE_HEADER");
    expect(f[0].action).toBe("mask");
    expect(f[0].maskTag).toBe("<<PRIVACY_MASK:COOKIE_HEADER>>");
    expect(f[0].matched).toBe("Cookie: session=abc123");
  });

  it("detects Set-Cookie header", () => {
    const f = scanSecrets("Set-Cookie: sid=xyz");
    expect(f[0].category).toBe("SET_COOKIE_HEADER");
    expect(f[0].maskTag).toBe("<<PRIVACY_MASK:SET_COOKIE_HEADER>>");
    expect(f[0].matched).toBe("Set-Cookie: sid=xyz");
  });

  it("detects PostgreSQL URI", () => {
    const f = scanSecrets("postgres://user:pass@db.example.com:5432/mydb");
    expect(f[0].category).toBe("DB_URI");
    expect(f[0].maskTag).toBe("<<PRIVACY_MASK:DB_URI>>");
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
    expect(f[0].maskTag).toBe("<<PRIVACY_MASK:AWS_ACCESS_KEY>>");
    expect(f[0].matched).toBe("AKIAIOSFODNN7EXAMPLE");
  });

  it("detects AWS ASIA key", () => {
    const f = scanSecrets("key=ASIAIOSFODNN7EXAMPLE1");
    expect(f[0].category).toBe("AWS_ACCESS_KEY");
  });

  it("detects GitHub PAT", () => {
    const f = scanSecrets("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij");
    expect(f[0].category).toBe("GITHUB_TOKEN");
    expect(f[0].maskTag).toBe("<<PRIVACY_MASK:GITHUB_TOKEN>>");
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
    expect(f[0].maskTag).toBe("<<PRIVACY_MASK:SLACK_TOKEN>>");
  });

  it("detects Slack user token (xoxp)", () => {
    const f = scanSecrets("xoxp-1234567890-abcdefghijk");
    expect(f[0].category).toBe("SLACK_TOKEN");
  });

  it("detects Google API key", () => {
    const f = scanSecrets("AIzaSyA1234567890abcdefghijklmnopqrstuvwx");
    expect(f[0].category).toBe("GOOGLE_API_KEY");
    expect(f[0].maskTag).toBe("<<PRIVACY_MASK:GOOGLE_API_KEY>>");
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

  it("detects single-segment base64 opaque token (Cloudflare tunnel token)", () => {
    const cfToken = "eyJhIjoiZjU0Y2YxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1NiIsImIiOiJhYmMxMjNkZWY0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNCJ9";
    const f = scanSecrets(`command: tunnel --no-autoupdate --protocol http2 run --token ${cfToken}`);
    expect(f).toContainEqual(
      expect.objectContaining({ category: "BASE64_TOKEN", action: "mask", maskTag: "<<PRIVACY_MASK:BASE64_TOKEN>>" })
    );
  });

  it("does not false-match first segment of 3-part JWT as BASE64_TOKEN", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const f = scanSecrets(jwt);
    expect(f).toContainEqual(expect.objectContaining({ category: "JWT" }));
    expect(f.every(x => x.category !== "BASE64_TOKEN")).toBe(true);
  });

  it("detects Stripe live secret key", () => {
    const prefix = "sk_" + "live_";
    const f = scanSecrets(prefix + "FAKE51Hj8V2e2vZ9x7abcdef123456");
    expect(f).toContainEqual(
      expect.objectContaining({ category: "STRIPE_KEY", action: "mask", maskTag: "<<PRIVACY_MASK:STRIPE_KEY>>" })
    );
  });

  it("detects Stripe test secret key", () => {
    const prefix = "sk_" + "test_";
    const f = scanSecrets(prefix + "FAKE51Hj8V2e2vZ9x7abcdef123456");
    expect(f).toContainEqual(
      expect.objectContaining({ category: "STRIPE_KEY" })
    );
  });

  it("does SendGrid API key", () => {
    const f = scanSecrets("SG.ABCDEFGHIJKLMNOPQR.baCdefGhIjKlMnOpQrStUvWxYz0123456789abcdefGhIjKlMnOpQrStUvWxYz0");
    expect(f).toContainEqual(
      expect.objectContaining({ category: "SENDGRID_KEY", action: "mask", maskTag: "<<PRIVACY_MASK:SENDGRID_KEY>>" })
    );
  });

  it("ignores short eyJ strings (< 40 chars)", () => {
    const f = scanSecrets("eyJhIjoic2ltcGxlc3RyaW5n");
    expect(f.every(x => x.category !== "BASE64_TOKEN")).toBe(true);
  });

  it("detects multiple Stripe keys in same text", () => {
    const p = "sk_" + "live_";
    const f = scanSecrets("key1=" + p + "FAKE51Hj8V2e2vZ9x7abcdef123456 key2=" + p + "FAKE9kLmNoPqRsTuVwXyzABCDEF123");
    expect(f.filter(x => x.category === "STRIPE_KEY")).toHaveLength(2);
    expect(f.every(x => x.action === "mask")).toBe(true);
  });

  it("detects base64 token after a JWT in same text", () => {
    const fakeToken = "eyJhIjoiZjU0Y2YxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1NiIsImIiOiJhYmMxMjNkZWY0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNCJ9";
    const text = `jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig token=${fakeToken}`;
    const f = scanSecrets(text);
    expect(f.some(x => x.category === "JWT")).toBe(true);
    expect(f.some(x => x.category === "BASE64_TOKEN" && x.matched === fakeToken)).toBe(true);
  });

  it("keeps standalone base64 token even when identical string appears inside a JWT", () => {
    const payload = "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ";
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`;
    const text = `${jwt} standalone=${payload}`;
    const f = scanSecrets(text);
    expect(f.some(x => x.category === "JWT")).toBe(true);
    expect(f.filter(x => x.category === "BASE64_TOKEN")).toHaveLength(1);
  });

  it("detects multiple private keys in same text", () => {
    const text = `-----BEGIN RSA PRIVATE KEY-----
abc
-----END RSA PRIVATE KEY-----

-----BEGIN EC PRIVATE KEY-----
def
-----END EC PRIVATE KEY-----`;
    const f = scanSecrets(text);
    expect(f.filter(x => x.category === "PRIVATE_KEY")).toHaveLength(2);
    expect(f.every(x => x.action === "mask")).toBe(true);
  });
});

describe("scanSecrets — expanded provider/developer/cloud packs", () => {
  it("detects LLM provider token prefixes", () => {
    const openai = "sk-" + "proj-" + "A1".repeat(18);
    const anthropic = "sk-ant-" + "B2".repeat(18);
    const huggingFace = "hf_" + "C3".repeat(14);
    const f = scanSecrets(`${openai} ${anthropic} ${huggingFace}`);

    expect(f.filter((x) => x.category === "PROVIDER_API_KEY")).toHaveLength(3);
    expect(f.every((x) => x.action === "mask")).toBe(true);
  });

  it("detects OpenRouter, Groq, Replicate, and Perplexity provider tokens", () => {
    const openRouter = "sk-or-v1-" + "D4".repeat(18);
    const groq = "gsk_" + "E5".repeat(16);
    const replicate = "r8_" + "F6".repeat(16);
    const perplexity = "pplx-" + "G7".repeat(16);
    const f = scanSecrets(`${openRouter}\n${groq}\n${replicate}\n${perplexity}`);

    expect(f.filter((x) => x.category === "PROVIDER_API_KEY")).toHaveLength(4);
  });

  it("detects expanded GitHub token prefixes", () => {
    const prefixes = ["gho_", "ghu_", "ghs_", "ghr_"];
    const f = scanSecrets(prefixes.map((prefix) => prefix + "A".repeat(36)).join("\n"));

    expect(f.filter((x) => x.category === "GITHUB_TOKEN")).toHaveLength(prefixes.length);
  });

  it("detects GitLab, npm, PyPI, and Vercel developer tokens", () => {
    const gitlab = "glpat-" + "H8".repeat(12);
    const npm = "npm_" + "I9".repeat(18);
    const pypi = "pypi-" + "J0".repeat(28);
    const vercel = "vercel_" + "K1".repeat(14);
    const f = scanSecrets(`${gitlab} ${npm} ${pypi} ${vercel}`);

    expect(f.filter((x) => x.category === "DEVELOPER_TOKEN")).toHaveLength(4);
  });

  it("detects broader credentialed connection strings", () => {
    const amqp = "amqps://gateway:pa55w0rd@mq.example.test/vhost";
    const jdbc = "jdbc:postgresql://db.example.test:5432/app?user=gateway&password=pa55w0rd";
    const f = scanSecrets(`${amqp}\n${jdbc}`);

    expect(f.filter((x) => x.category === "CONNECTION_STRING")).toHaveLength(2);
  });

  it("detects Azure storage, netrc, and curl credential snippets", () => {
    const azure = "DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=" + "L2".repeat(24) + ";EndpointSuffix=core.windows.net";
    const netrc = "machine api.example.test login gateway password pa55w0rd-token";
    const curl = "curl --user gateway:pa55w0rd-token https://api.example.test";
    const f = scanSecrets(`${azure}\n${netrc}\n${curl}`);

    expect(f).toContainEqual(expect.objectContaining({ category: "CONNECTION_STRING" }));
    expect(f.filter((x) => x.category === "CLOUD_CREDENTIAL")).toHaveLength(2);
  });
});
