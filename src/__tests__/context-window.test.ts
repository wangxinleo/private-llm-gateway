import { describe, it, expect } from "vitest";
import {
  hasStrongSecretSignal,
  sliceWindow,
  scanContextWindows,
  CONTEXT_WINDOW,
} from "@/scanner/context-window";
import { globToRegExp, locateHighRiskAssets } from "@/scanner/high-risk-assets";

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

describe("hasStrongSecretSignal (D7 四重信号)", () => {
  it("chaos token: 无序 8+ 位字符命中", () => {
    expect(hasStrongSecretSignal("key aB3x9K2mQwe7")).toBe(true);
    expect(hasStrongSecretSignal("secret wx456_klm")).toBe(true);
  });

  it("chaos token: 纯字母单词/纯数字/重复字符/已知明文词不命中", () => {
    expect(hasStrongSecretSignal("the password is password")).toBe(false);
    expect(hasStrongSecretSignal("BasicFlow is a flow")).toBe(false);
    expect(hasStrongSecretSignal("order 12345678")).toBe(false);
    expect(hasStrongSecretSignal("aaaaaaa")).toBe(false);
    expect(hasStrongSecretSignal("use example.com")).toBe(false);
  });

  it("口令标志后值命中", () => {
    expect(hasStrongSecretSignal("passwd: xyz123!")).toBe(true);
    expect(hasStrongSecretSignal("PASSWORD=abcDEF9")).toBe(true);
    expect(hasStrongSecretSignal("pwd:hunter2")).toBe(true);
  });

  it("关键词信号命中", () => {
    expect(hasStrongSecretSignal("the api_key is aB3x9K2mQwe7")).toBe(true);
    expect(hasStrongSecretSignal("authorization: gX9mQ2kL8v")).toBe(true);
  });

  it("强规则前缀命中", () => {
    expect(hasStrongSecretSignal("ghp_" + "A".repeat(40))).toBe(true);
    expect(hasStrongSecretSignal("sk-proj-" + "B".repeat(20))).toBe(true);
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
    const text = "account wangxinleo secret aB3x9K2mQwe7";
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

  it("窗口边界外不误报", () => {
    const text =
      "wangxinleo" + " ".repeat(CONTEXT_WINDOW * 2) + "aB3x9K2mQwe7";
    const findings = scanContextWindows(text, {
      domains: [],
      emails: [],
      accounts: ["wangxinleo"],
    });
    expect(findings.length).toBe(0);
  });
});