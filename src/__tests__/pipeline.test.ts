import { describe, it, expect, beforeEach } from "vitest";
import { runPipeline } from "@/scanner/pipeline";
import { HIGH_RISK_ASSETS } from "@/config";

function withWhitelist(text: string, assets: typeof HIGH_RISK_ASSETS = HIGH_RISK_ASSETS) {
  // 直接操纵内存态,模拟设置页保存后的白名单
  const prev = {
    domains: [...HIGH_RISK_ASSETS.domains],
    emails: [...HIGH_RISK_ASSETS.emails],
    accounts: [...HIGH_RISK_ASSETS.accounts],
  };
  HIGH_RISK_ASSETS.domains = assets.domains;
  HIGH_RISK_ASSETS.emails = assets.emails;
  HIGH_RISK_ASSETS.accounts = assets.accounts;
  return () => {
    HIGH_RISK_ASSETS.domains = prev.domains;
    HIGH_RISK_ASSETS.emails = prev.emails;
    HIGH_RISK_ASSETS.accounts = prev.accounts;
  };
}

describe("runPipeline — whitelist-gated scanning", () => {
  beforeEach(() => {
    // 默认白名单清空,确保测试隔离
    HIGH_RISK_ASSETS.domains = [];
    HIGH_RISK_ASSETS.emails = [];
    HIGH_RISK_ASSETS.accounts = [];
  });

  it("allows clean text", () => {
    const r = runPipeline("Hello, world!", 100);
    expect(r.action).toBe("allow");
    expect(r.findings).toHaveLength(0);
  });

  it("allows secrets outside whitelist windows (no anchor)", () => {
    const r = runPipeline("the token abc123token appears in prose without context", 100);
    expect(r.action).toBe("allow");
    expect(r.findings).toHaveLength(0);
  });

  it("allows emails outside whitelist (no anchor)", () => {
    const r = runPipeline("contact: user@example.com", 100);
    expect(r.action).toBe("allow");
    expect(r.findings).toHaveLength(0);
  });

  it("masks secrets inside whitelist window", () => {
    const restore = withWhitelist("", { domains: [], emails: [], accounts: ["wangxinleo"] });
    try {
      const r = runPipeline("account wangxinleo token Bearer abc123token", 100);
      expect(r.action).toBe("mask");
      expect(r.maskedBody).toContain("<<PRIVACY_MASK:BEARER_TOKEN>>");
      expect(r.maskedBody).not.toContain("abc123token");
    } finally {
      restore();
    }
  });

  it("masks email inside whitelist window", () => {
    const restore = withWhitelist("", { domains: [], emails: [], accounts: ["wangxinleo"] });
    try {
      const r = runPipeline("account wangxinleo mail user@example.com", 100);
      expect(r.action).toBe("mask");
      expect(r.maskedBody).toContain("<<PRIVACY_MASK:EMAIL>>");
    } finally {
      restore();
    }
  });

  it("masks private key inside whitelist window", () => {
    const restore = withWhitelist("", { domains: [], emails: [], accounts: ["wangxinleo"] });
    try {
      const text =
        "account wangxinleo\n-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----";
      const r = runPipeline(text, 100);
      expect(r.action).toBe("mask");
      expect(r.maskedBody).toContain("<<PRIVACY_MASK:PRIVATE_KEY>>");
    } finally {
      restore();
    }
  });

  it("masks DB URI inside whitelist window", () => {
    const restore = withWhitelist("", { domains: [], emails: [], accounts: ["wangxinleo"] });
    try {
      const r = runPipeline("account wangxinleo db postgres://user:pass@host/db", 100);
      expect(r.action).toBe("mask");
      expect(r.maskedBody).toContain("<<PRIVACY_MASK:DB_URI>>");
    } finally {
      restore();
    }
  });

  it("masks AWS key inside whitelist window", () => {
    const restore = withWhitelist("", { domains: [], emails: [], accounts: ["wangxinleo"] });
    try {
      const r = runPipeline("account wangxinleo key=AKIAIOSFODNN7EXAMPLE", 100);
      expect(r.action).toBe("mask");
      expect(r.maskedBody).toContain("<<PRIVACY_MASK:AWS_ACCESS_KEY>>");
    } finally {
      restore();
    }
  });

  it("masks GitHub token inside whitelist window", () => {
    const restore = withWhitelist("", { domains: [], emails: [], accounts: ["wangxinleo"] });
    try {
      const r = runPipeline(
        "account wangxinleo ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
        100
      );
      expect(r.action).toBe("mask");
      expect(r.maskedBody).toContain("<<PRIVACY_MASK:GITHUB_TOKEN>>");
    } finally {
      restore();
    }
  });

  it("masks context key value inside whitelist window", () => {
    const restore = withWhitelist("", { domains: [], emails: [], accounts: ["wangxinleo"] });
    try {
      const r = runPipeline(
        'account wangxinleo "api_key": "aBcDeFgHiJkLmNoPqRsTuVwXyZ012"',
        100
      );
      expect(r.action).toBe("mask");
      expect(r.maskedBody).toContain("<<PRIVACY_MASK:CONTEXTUAL_SECRET>>");
    } finally {
      restore();
    }
  });

  it("masks strong-signal secrets outside whitelist window when anchor present", () => {
    const restore = withWhitelist("", { domains: [], emails: [], accounts: ["wangxinleo"] });
    try {
      const r = runPipeline("contact wangxinleo sk-proj-" + "B".repeat(20), 100);
      expect(r.action).toBe("mask");
      expect(r.maskedBody).toContain("<<PRIVACY_MASK:PROVIDER_API_KEY>>");
    } finally {
      restore();
    }
  });

  it("masks PHONE regardless of whitelist (global PII)", () => {
    const r = runPipeline("手机号：13912345678", 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:PHONE>>");
  });

  it("masks ID card regardless of whitelist (global PII)", () => {
    const r = runPipeline("身份证：330106200002020010", 100);
    expect(r.action).toBe("mask");
    expect(r.maskedBody).toContain("<<PRIVACY_MASK:ID_CARD>>");
  });

  it("masks PHONE alongside whitelist-window secrets", () => {
    const restore = withWhitelist("", { domains: [], emails: [], accounts: ["wangxinleo"] });
    try {
      const r = runPipeline("account wangxinleo Bearer abc123token phone 13912345678", 100);
      expect(r.action).toBe("mask");
      expect(r.maskedBody).toContain("<<PRIVACY_MASK:BEARER_TOKEN>>");
      expect(r.maskedBody).toContain("<<PRIVACY_MASK:PHONE>>");
    } finally {
      restore();
    }
  });

  it("filename block triggers immediate block", () => {
    const r = runPipeline("normal text", 100, ["id_rsa", "config.json"]);
    expect(r.action).toBe("block");
    expect(
      r.findings.some((f) => f.category === "SENSITIVE_FILENAME")
    ).toBe(true);
  });

  it("blocks sensitive filename extension", () => {
    const r = runPipeline("upload", 100, ["secrets.pem"]);
    expect(r.action).toBe("block");
  });

  it("block only happens for filename", () => {
    const restore = withWhitelist("", { domains: [], emails: [], accounts: ["wangxinleo"] });
    try {
      const r = runPipeline("account wangxinleo Bearer abc123token", 100);
      expect(r.action).toBe("mask");
      expect(r.action).not.toBe("block");
    } finally {
      restore();
    }
  });

  it("large body still catches secrets inside whitelist window", () => {
    const restore = withWhitelist("", { domains: [], emails: [], accounts: ["wangxinleo"] });
    try {
      const text =
        "account wangxinleo\n-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----";
      const r = runPipeline(text, 1024 * 1024 + 100);
      expect(r.action).toBe("mask");
      expect(r.maskedBody).toContain("<<PRIVACY_MASK:PRIVATE_KEY>>");
    } finally {
      restore();
    }
  });

  it("does not mask secrets far outside whitelist window", () => {
    const restore = withWhitelist("", { domains: [], emails: [], accounts: ["wangxinleo"] });
    try {
      const text = "wangxinleo" + " x".repeat(500) + " Bearer abc123token";
      const r = runPipeline(text, 100);
      expect(r.action).toBe("allow");
    } finally {
      restore();
    }
  });
});