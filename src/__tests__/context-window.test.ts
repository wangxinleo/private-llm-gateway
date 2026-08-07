import { describe, it, expect } from "vitest";
import {
  sliceWindow,
  scanContextWindows,
  CONTEXT_WINDOW,
} from "@/scanner/context-window";
import { globToRegExp, locateHighRiskAssets } from "@/scanner/high-risk-assets";
import { CONTEXT_WINDOW_SIZE } from "@/config";

describe("globToRegExp", () => {
  it("matches wildcard * as any sequence", () => {
    expect(globToRegExp("*.ccload.com").test("app.ccload.com")).toBe(true);
    expect(globToRegExp("*.ccload.com").test("deep.app.ccload.com")).toBe(true);
    expect(globToRegExp("*.ccload.com").test("ccload.com")).toBe(false);
    expect(globToRegExp("*.ccload.com").test("app.gffunds.com")).toBe(false);
  });

  it("escapes regex special chars", () => {
    expect(globToRegExp("a.b.c").test("aXbXc")).toBe(false);
    expect(globToRegExp("a.b.c").test("a.b.c")).toBe(true);
  });

  it("email and account patterns", () => {
    expect(globToRegExp("*@*.ccload.com").test("user@app.ccload.com")).toBe(true);
    expect(globToRegExp("ft-*").test("ft-gateway")).toBe(true);
    expect(globToRegExp("ft-*").test("wangxinleo")).toBe(false);
  });
});

describe("locateHighRiskAssets", () => {
  const assets = {
    domains: ["*.ccload.com", "*.gffunds.com"],
    emails: ["*@*.ccload.com"],
    accounts: ["wangxinleo"],
  };

  it("locates whitelisted domain URLs", () => {
    const text = "See https://app.ccload.com/v1 and https://api.gffunds.com/x";
    const hits = locateHighRiskAssets(text, assets);
    expect(hits.map((h) => h.value)).toEqual([
      "https://app.ccload.com/v1",
      "https://api.gffunds.com/x",
    ]);
  });

  it("does not locate foreign domains", () => {
    const text = "See https://api.example.test/v1 for docs";
    const hits = locateHighRiskAssets(text, assets);
    expect(hits).toHaveLength(0);
  });

  it("locates whitelisted emails", () => {
    const text = "contact user@svc.ccload.com or other@example.com";
    const hits = locateHighRiskAssets(text, assets);
    expect(hits.map((h) => h.value)).toEqual(["user@svc.ccload.com"]);
  });

  it("locates account names as literal occurrences", () => {
    const text = "login wangxinleo configured";
    const hits = locateHighRiskAssets(text, assets);
    expect(hits.map((h) => h.value)).toEqual(["wangxinleo"]);
  });
});

describe("sliceWindow", () => {
  it("cuts ±200 chars around hit", () => {
    const text = "x".repeat(100) + "TARGET" + "y".repeat(100);
    const window = sliceWindow(text, { value: "TARGET", start: 100, end: 106 });
    expect(window).toBe(text);
    expect(window.length).toBe(206);
  });

  it("clamps at text boundaries", () => {
    const text = "TARGET" + "y".repeat(300);
    const window = sliceWindow(text, { value: "TARGET", start: 0, end: 6 });
    expect(window).toHaveLength(6 + CONTEXT_WINDOW);
  });
});

describe("scanContextWindows", () => {
  it("扫描白名单命中值窗口内的疑似密钥", () => {
    const text = "account wangxinleo Bearer abc123token4567890xyz";
    const findings = scanContextWindows(text, {
      domains: [],
      emails: [],
      accounts: ["wangxinleo"],
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  it("白名单外完全不扫描", () => {
    const text = "prose URL https://api.example.test/v1 with commit abcdef1234567890";
    const findings = scanContextWindows(text, {
      domains: [],
      emails: [],
      accounts: [],
    });
    expect(findings.length).toBe(0);
  });

  it("无白名单时 secrets 不扫描", () => {
    const text = "the token abc123token appears in prose without context";
    const findings = scanContextWindows(text, {
      domains: [],
      emails: [],
      accounts: [],
    });
    expect(findings.length).toBe(0);
  });

  it("无白名单时 email 不扫描", () => {
    const text = "contact: user@example.com";
    const findings = scanContextWindows(text, {
      domains: [],
      emails: [],
      accounts: [],
    });
    expect(findings).not.toContainEqual(expect.objectContaining({ category: "EMAIL" }));
  });

  it("窗口边界:窗内 secrets 命中,窗外不扫描", () => {
    const inside = "wangxinleo Bearer abc123token4567890xyz";
    const insideFindings = scanContextWindows(inside, {
      domains: [],
      emails: [],
      accounts: ["wangxinleo"],
    });
    expect(insideFindings.some((f) => f.category === "BEARER_TOKEN")).toBe(true);
    const outside =
      "wangxinleo" + " ".repeat(CONTEXT_WINDOW * 2) + "Bearer abc123token4567890xyz";
    const outsideFindings = scanContextWindows(outside, {
      domains: [],
      emails: [],
      accounts: ["wangxinleo"],
    });
    expect(outsideFindings.some((f) => f.category === "BEARER_TOKEN")).toBe(false);
  });

  it("白名单窗口内 EMAIL 被扫描", () => {
    const text = "contact wangxinleo mail user@example.com";
    const findings = scanContextWindows(text, {
      domains: [],
      emails: [],
      accounts: ["wangxinleo"],
    });
    expect(findings.some((f) => f.category === "EMAIL")).toBe(true);
  });

  it("白名单窗口外 EMAIL 不扫描", () => {
    const text = "wangxinleo" + " x".repeat(500) + " mail user@example.com";
    const findings = scanContextWindows(text, {
      domains: [],
      emails: [],
      accounts: ["wangxinleo"],
    });
    expect(findings.some((f) => f.category === "EMAIL")).toBe(false);
  });

  it("PHONE 全文扫描不受白名单限制", () => {
    const text = "phone 13912345678";
    const findings = scanContextWindows(text, {
      domains: [],
      emails: [],
      accounts: [],
    });
    expect(findings.some((f) => f.category === "PHONE")).toBe(true);
  });

  it("窗口大小热更新后生效", () => {
    const prev = CONTEXT_WINDOW_SIZE.value;
    CONTEXT_WINDOW_SIZE.value = 50;
    try {
      const text = "wangxinleo" + " x".repeat(100) + " Bearer abc123token4567890xyz";
      const findings = scanContextWindows(text, {
        domains: [],
        emails: [],
        accounts: ["wangxinleo"],
      });
      // 100 字符间隔超过 50 半径,Bearer token 不应命中
      expect(findings.length).toBe(0);
    } finally {
      CONTEXT_WINDOW_SIZE.value = prev;
    }
  });
});