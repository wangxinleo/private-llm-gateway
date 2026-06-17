import { describe, it, expect } from "vitest";
import { applyMasks } from "@/scanner/pii";
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
