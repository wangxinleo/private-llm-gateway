import { describe, it, expect } from "vitest";
import { applyMasks } from "@/scanner/pii";
import { MaskRegistry } from "@/scanner/mask-registry";
import type { Finding } from "@/types";

function mask(text: string, findings: Finding[]): string {
  return applyMasks(text, findings).masked;
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
        maskTag: "<<PRIVACY_MASK:PRIVATE_KEY>>",
      },
    ];
    expect(mask(text, f)).toBe("<<PRIVACY_MASK:PRIVATE_KEY>>");
  });

  it("masks Bearer token", () => {
    const text = "Authorization: Bearer abc123token";
    const f: Finding[] = [
      {
        category: "BEARER_TOKEN",
        action: "mask",
        matched: "Bearer abc123token",
        maskTag: "<<PRIVACY_MASK:BEARER_TOKEN>>",
      },
    ];
    expect(mask(text, f)).toBe("Authorization: <<PRIVACY_MASK:BEARER_TOKEN>>");
  });

  it("masks Basic auth", () => {
    const text = "Authorization: Basic dXNlcjpwYXNz";
    const f: Finding[] = [
      {
        category: "BASIC_AUTH",
        action: "mask",
        matched: "Basic dXNlcjpwYXNz",
        maskTag: "<<PRIVACY_MASK:BASIC_AUTH>>",
      },
    ];
    expect(mask(text, f)).toBe("Authorization: <<PRIVACY_MASK:BASIC_AUTH>>");
  });

  it("masks JWT", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc123def";
    const text = `token=${token}`;
    const f: Finding[] = [
      {
        category: "JWT",
        action: "mask",
        matched: token,
        maskTag: "<<PRIVACY_MASK:JWT>>",
      },
    ];
    expect(mask(text, f)).toBe("token=<<PRIVACY_MASK:JWT>>");
  });

  it("masks Cookie header", () => {
    const text = "Cookie: session=abc";
    const f: Finding[] = [
      {
        category: "COOKIE_HEADER",
        action: "mask",
        matched: "Cookie: session=abc",
        maskTag: "<<PRIVACY_MASK:COOKIE_HEADER>>",
      },
    ];
    expect(mask(text, f)).toBe("<<PRIVACY_MASK:COOKIE_HEADER>>");
  });

  it("masks Set-Cookie header", () => {
    const text = "Set-Cookie: sid=xyz";
    const f: Finding[] = [
      {
        category: "SET_COOKIE_HEADER",
        action: "mask",
        matched: "Set-Cookie: sid=xyz",
        maskTag: "<<PRIVACY_MASK:SET_COOKIE_HEADER>>",
      },
    ];
    expect(mask(text, f)).toBe("<<PRIVACY_MASK:SET_COOKIE_HEADER>>");
  });

  it("masks DB URI", () => {
    const text = "postgres://user:pass@host/db";
    const f: Finding[] = [
      {
        category: "DB_URI",
        action: "mask",
        matched: "postgres://user:pass@host/db",
        maskTag: "<<PRIVACY_MASK:DB_URI>>",
      },
    ];
    expect(mask(text, f)).toBe("<<PRIVACY_MASK:DB_URI>>");
  });

  it("masks AWS access key", () => {
    const text = "AKIAIOSFODNN7EXAMPLE";
    const f: Finding[] = [
      {
        category: "AWS_ACCESS_KEY",
        action: "mask",
        matched: "AKIAIOSFODNN7EXAMPLE",
        maskTag: "<<PRIVACY_MASK:AWS_ACCESS_KEY>>",
      },
    ];
    expect(mask(text, f)).toBe("<<PRIVACY_MASK:AWS_ACCESS_KEY>>");
  });

  it("masks GitHub token", () => {
    const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    const f: Finding[] = [
      {
        category: "GITHUB_TOKEN",
        action: "mask",
        matched: token,
        maskTag: "<<PRIVACY_MASK:GITHUB_TOKEN>>",
      },
    ];
    expect(mask(token, f)).toBe("<<PRIVACY_MASK:GITHUB_TOKEN>>");
  });

  it("masks Slack token", () => {
    const token = "xoxb-123-abc";
    const f: Finding[] = [
      {
        category: "SLACK_TOKEN",
        action: "mask",
        matched: token,
        maskTag: "<<PRIVACY_MASK:SLACK_TOKEN>>",
      },
    ];
    expect(mask(token, f)).toBe("<<PRIVACY_MASK:SLACK_TOKEN>>");
  });

  it("masks Google API key", () => {
    const key = "AIzaSyA1234567890abcdefghijklmnopqrstuvwx";
    const f: Finding[] = [
      {
        category: "GOOGLE_API_KEY",
        action: "mask",
        matched: key,
        maskTag: "<<PRIVACY_MASK:GOOGLE_API_KEY>>",
      },
    ];
    expect(mask(key, f)).toBe("<<PRIVACY_MASK:GOOGLE_API_KEY>>");
  });

  it("masks context key value", () => {
    const value = "aBcDeFgHiJkLmNoPqRsTuVwXyZ012";
    const text = `"api_key": "${value}"`;
    const f: Finding[] = [
      {
        category: "CONTEXTUAL_SECRET",
        action: "mask",
        matched: value,
        maskTag: "<<PRIVACY_MASK:CONTEXTUAL_SECRET>>",
      },
    ];
    expect(mask(text, f)).toBe(`"api_key": "<<PRIVACY_MASK:CONTEXTUAL_SECRET>>"`);
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
        maskTag: "<<PRIVACY_MASK:BEARER_TOKEN>>",
      },
      {
        category: "PHONE",
        action: "mask",
        matched: "13912345678",
        maskTag: "<<PRIVACY_MASK:PHONE>>",
      },
    ];
    expect(mask(text, f)).toBe("<<PRIVACY_MASK:BEARER_TOKEN>> phone <<PRIVACY_MASK:PHONE>>");
  });

  it("masks PII types correctly", () => {
    const f: Finding[] = [
      {
        category: "PHONE",
        action: "mask",
        matched: "13912345678",
        maskTag: "<<PRIVACY_MASK:PHONE>>",
      },
    ];
    expect(mask("call 13912345678 now", f)).toBe("call <<PRIVACY_MASK:PHONE>> now");
  });

  it("masks email", () => {
    const f: Finding[] = [
      {
        category: "EMAIL",
        action: "mask",
        matched: "user@example.com",
        maskTag: "<<PRIVACY_MASK:EMAIL>>",
      },
    ];
    expect(mask("contact user@example.com", f)).toBe("contact <<PRIVACY_MASK:EMAIL>>");
  });

  it("masks ID card", () => {
    const id = "330106200002020012";
    const f: Finding[] = [
      {
        category: "ID_CARD",
        action: "mask",
        matched: id,
        maskTag: "<<PRIVACY_MASK:ID_CARD>>",
      },
    ];
    expect(mask(`身份证${id}`, f)).toBe("身份证<<PRIVACY_MASK:ID_CARD>>");
  });

  it("masks bank card", () => {
    const card = "6222021234567890123";
    const f: Finding[] = [
      {
        category: "BANK_CARD",
        action: "mask",
        matched: card,
        maskTag: "<<PRIVACY_MASK:BANK_CARD>>",
      },
    ];
    expect(mask(`卡号${card}`, f)).toBe("卡号<<PRIVACY_MASK:BANK_CARD>>");
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
    maskTag: "<<PRIVACY_MASK:PHONE>>",
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
      { category: "EMAIL", action: "mask", matched: "a@x.com", maskTag: "<<PRIVACY_MASK:EMAIL>>" },
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
      { category: "CONTEXTUAL_SECRET", action: "mask", matched: "PHONE_TRWMQ", maskTag: "<<PRIVACY_MASK:CONTEXTUAL_SECRET>>" },
      phoneFinding,
    ], registry);
    expect(result.masked).toContain("{{PHONE_TRWMQ}}");
    expect(result.masked).not.toContain("13912345678");
    expect(result.masked).toMatch(/\{\{PHONE_[bcdfghjkmnpqrstvwxz]{5}\}\}/);
  });

  it("segment protection also works without a registry (template tags)", () => {
    const result = applyMasks("keep {{PHONE_TRWMQ}} intact, phone 13912345678", [
      { category: "CONTEXTUAL_SECRET", action: "mask", matched: "PHONE_TRWMQ", maskTag: "<<PRIVACY_MASK:CONTEXTUAL_SECRET>>" },
      phoneFinding,
    ]);
    expect(result.masked).toContain("{{PHONE_TRWMQ}}");
    expect(result.masked).toContain("<<PRIVACY_MASK:PHONE>>");
  });

  it("does not register mappings for values absent from the text", () => {
    const registry = new MaskRegistry();
    applyMasks("nothing to see here", [phoneFinding], registry);
    expect(registry.size).toBe(0);
  });
});
