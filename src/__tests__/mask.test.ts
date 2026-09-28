import { describe, it, expect } from "vitest";
import { applyMasks } from "@/scanner/pii";
import { MaskRegistry } from "@/scanner/mask-registry";
import type { Finding } from "@/types";

function mask(text: string, findings: Finding[]): string {
  return applyMasks(text, findings, new MaskRegistry(() => "bcdfg")).masked;
}

describe("applyMasks — secret masking", () => {
  it("masks private key block", () => {
    const text =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----";
    const f: Finding[] = [
      {
        category: "PRIVATE_KEY",
        action: "mask",
        matched: text,
      },
    ];
    expect(mask(text, f)).toBe("{{PRIVATE_KEY_bcdfg}}");
  });

  it("masks Bearer token", () => {
    const text = "Authorization: Bearer abc123token";
    const f: Finding[] = [
      {
        category: "BEARER_TOKEN",
        action: "mask",
        matched: "Bearer abc123token",
      },
    ];
    expect(mask(text, f)).toBe("Authorization: {{BEARER_bcdfg}}");
  });

  it("masks Basic auth", () => {
    const text = "Authorization: Basic dXNlcjpwYXNz";
    const f: Finding[] = [
      {
        category: "BASIC_AUTH",
        action: "mask",
        matched: "Basic dXNlcjpwYXNz",
      },
    ];
    expect(mask(text, f)).toBe("Authorization: {{BASIC_AUTH_bcdfg}}");
  });

  it("masks JWT", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc123def";
    const text = `token=${token}`;
    const f: Finding[] = [
      {
        category: "JWT",
        action: "mask",
        matched: token,
      },
    ];
    expect(mask(text, f)).toBe("token={{JWT_bcdfg}}");
  });

  it("masks Cookie header", () => {
    const text = "Cookie: session=abc";
    const f: Finding[] = [
      {
        category: "COOKIE_HEADER",
        action: "mask",
        matched: "Cookie: session=abc",
      },
    ];
    expect(mask(text, f)).toBe("{{COOKIE_bcdfg}}");
  });

  it("masks Set-Cookie header", () => {
    const text = "Set-Cookie: sid=xyz";
    const f: Finding[] = [
      {
        category: "SET_COOKIE_HEADER",
        action: "mask",
        matched: "Set-Cookie: sid=xyz",
      },
    ];
    expect(mask(text, f)).toBe("{{SET_COOKIE_bcdfg}}");
  });

  it("masks DB URI", () => {
    const text = "postgres://user:pass@host/db";
    const f: Finding[] = [
      {
        category: "DB_URI",
        action: "mask",
        matched: "postgres://user:pass@host/db",
      },
    ];
    expect(mask(text, f)).toBe("{{DB_URI_bcdfg}}");
  });

  it("masks AWS access key", () => {
    const text = "AKIAIOSFODNN7EXAMPLE";
    const f: Finding[] = [
      {
        category: "AWS_ACCESS_KEY",
        action: "mask",
        matched: "AKIAIOSFODNN7EXAMPLE",
      },
    ];
    expect(mask(text, f)).toBe("{{AWS_KEY_bcdfg}}");
  });

  it("masks GitHub token", () => {
    const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    const f: Finding[] = [
      {
        category: "GITHUB_TOKEN",
        action: "mask",
        matched: token,
      },
    ];
    expect(mask(token, f)).toBe("{{GITHUB_bcdfg}}");
  });

  it("masks Slack token", () => {
    const token = "xoxb-123-abc";
    const f: Finding[] = [
      {
        category: "SLACK_TOKEN",
        action: "mask",
        matched: token,
      },
    ];
    expect(mask(token, f)).toBe("{{SLACK_bcdfg}}");
  });

  it("masks Google API key", () => {
    const key = "AIzaSyA1234567890abcdefghijklmnopqrstuvwx";
    const f: Finding[] = [
      {
        category: "GOOGLE_API_KEY",
        action: "mask",
        matched: key,
      },
    ];
    expect(mask(key, f)).toBe("{{GOOGLE_bcdfg}}");
  });

  it("masks context key value", () => {
    const value = "aBcDeFgHiJkLmNoPqRsTuVwXyZ012";
    const text = `"api_key": "${value}"`;
    const f: Finding[] = [
      {
        category: "CONTEXTUAL_SECRET",
        action: "mask",
        matched: value,
      },
    ];
    expect(mask(text, f)).toBe(`"api_key": "{{SECRET_bcdfg}}"`);
  });
});

describe("applyMasks — mixed findings", () => {
  it("masks Bearer token and phone together", () => {
    const text = "Bearer abc123token phone 13912345678";
    const f: Finding[] = [
      {
        category: "BEARER_TOKEN",
        action: "mask",
        matched: "Bearer abc123token",
      },
      {
        category: "PHONE",
        action: "mask",
        matched: "13912345678",
      },
    ];
    expect(mask(text, f)).toBe("{{BEARER_bcdfg}} phone {{PHONE_bcdfg}}");
  });

  it("masks PII types correctly", () => {
    const f: Finding[] = [
      {
        category: "PHONE",
        action: "mask",
        matched: "13912345678",
      },
    ];
    expect(mask("call 13912345678 now", f)).toBe("call {{PHONE_bcdfg}} now");
  });

  it("masks email", () => {
    const f: Finding[] = [
      {
        category: "EMAIL",
        action: "mask",
        matched: "user@example.com",
      },
    ];
    expect(mask("contact user@example.com", f)).toBe("contact {{EMAIL_bcdfg}}");
  });

  it("masks ID card", () => {
    const id = "330106200002020012";
    const f: Finding[] = [
      {
        category: "ID_CARD",
        action: "mask",
        matched: id,
      },
    ];
    expect(mask(`身份证${id}`, f)).toBe("身份证{{ID_CARD_bcdfg}}");
  });

  it("masks bank card", () => {
    const card = "6222021234567890123";
    const f: Finding[] = [
      {
        category: "BANK_CARD",
        action: "mask",
        matched: card,
      },
    ];
    expect(mask(`卡号${card}`, f)).toBe("卡号{{BANK_CARD_bcdfg}}");
  });

  it("returns original text when no mask findings", () => {
    const text = "hello world";
    expect(mask(text, [])).toBe(text);
  });
});

describe("applyMasks — registry mode", () => {
  const phoneFinding: Finding = {
    category: "PHONE",
    action: "mask",
    matched: "13912345678",
  };

  it("assigns instance tags via registry and records the mapping", () => {
    const registry = new MaskRegistry();
    const result = applyMasks("call 13912345678 now", [phoneFinding], registry);
    expect(result.registry).toBe(registry);
    expect(result.masked).toMatch(/\{\{PHONE_[bcdfghjkmnpqrstvwxz]{5}\}\}/);
    expect(result.masked).not.toContain("13912345678");
    expect(registry.size).toBe(1);
    expect(registry.tagToValue.get(result.masked.replace("call ", "").replace(" now", ""))).toBe("13912345678");
  });

  it("dedupes repeated values to one tag and counts each replacement", () => {
    const registry = new MaskRegistry();
    const result = applyMasks("a@x.com and a@x.com", [
      { category: "EMAIL", action: "mask", matched: "a@x.com" },
    ], registry);
    const [first, second] = result.masked.split(" and ");
    expect(first).toBe(second);
    expect(first).toMatch(/^\{\{EMAIL_[bcdfghjkmnpqrstvwxz]{5}\}\}$/);
    expect(registry.size).toBe(1);
    expect(result.replacementCount).toBe(2);
  });

  it("protects already-formed placeholders from later replacements", () => {
    const registry = new MaskRegistry();
    const result = applyMasks("keep {{PHONE_TRWMQ}} intact, phone 13912345678", [
      { category: "CONTEXTUAL_SECRET", action: "mask", matched: "PHONE_TRWMQ" },
      phoneFinding,
    ], registry);
    expect(result.masked).toContain("{{PHONE_TRWMQ}}");
    expect(result.masked).not.toContain("13912345678");
    expect(result.masked).toMatch(/\{\{PHONE_[bcdfghjkmnpqrstvwxz]{5}\}\}/);
  });

  it("segment protection keeps an existing placeholder intact with a deterministic registry", () => {
    const registry = new MaskRegistry(() => "bcdfg");
    const result = applyMasks("keep {{PHONE_TRWMQ}} intact, phone 13912345678", [
      { category: "CONTEXTUAL_SECRET", action: "mask", matched: "PHONE_TRWMQ" },
      phoneFinding,
    ], registry);
    expect(result.masked).toContain("{{PHONE_TRWMQ}}");
    expect(result.masked).toContain("{{PHONE_bcdfg}}");
  });

  it("does not register mappings for values absent from the text", () => {
    const registry = new MaskRegistry();
    applyMasks("nothing to see here", [phoneFinding], registry);
    expect(registry.size).toBe(0);
  });
});
