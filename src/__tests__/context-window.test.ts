import { describe, it, expect } from "vitest";
import {
  sliceWindow,
  scanContextWindows,
  CONTEXT_WINDOW,
} from "@/scanner/context-window";
import { CONTEXT_WINDOW_SIZE } from "@/config";

// 高风险资产白名单已下线:窗口锚点仅剩敏感键值对(api_key=/password: 等四类键)
const ANCHOR = 'api_key = aBcDeFgHiJkLmNoPqRsTuVwXyZ01234';

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

describe("scanContextWindows — sensitive key-value anchors", () => {
  it("锚点窗口内的疑似密钥被扫描", () => {
    const text = `${ANCHOR} Bearer abc123token4567890xyz`;
    const findings = scanContextWindows(text);
    expect(findings.some((f) => f.category === "BEARER_TOKEN")).toBe(true);
  });

  it("无锚点时 secrets 不扫描", () => {
    const text = "the token abc123token appears in prose without context";
    const findings = scanContextWindows(text);
    expect(findings.length).toBe(0);
  });

  it("无锚点时 email 不扫描", () => {
    const text = "contact: user@example.com";
    const findings = scanContextWindows(text);
    expect(findings).not.toContainEqual(expect.objectContaining({ category: "EMAIL" }));
  });

  it("窗口边界:窗内 secrets 命中,窗外不扫描", () => {
    const inside = `${ANCHOR} Bearer abc123token4567890xyz`;
    expect(scanContextWindows(inside).some((f) => f.category === "BEARER_TOKEN")).toBe(true);
    const outside = ANCHOR + " ".repeat(CONTEXT_WINDOW * 2) + "Bearer abc123token4567890xyz";
    expect(scanContextWindows(outside).some((f) => f.category === "BEARER_TOKEN")).toBe(false);
  });

  it("锚点窗口内 EMAIL 被扫描", () => {
    const text = `${ANCHOR} mail user@example.com`;
    expect(scanContextWindows(text).some((f) => f.category === "EMAIL")).toBe(true);
  });

  it("锚点窗口外 EMAIL 不扫描", () => {
    const text = ANCHOR + " x".repeat(500) + " mail user@example.com";
    expect(scanContextWindows(text).some((f) => f.category === "EMAIL")).toBe(false);
  });

  it("PHONE 全文扫描不受锚点限制", () => {
    const text = "phone 13912345678";
    expect(scanContextWindows(text).some((f) => f.category === "PHONE")).toBe(true);
  });

  it("窗口大小热更新后生效", () => {
    const prev = CONTEXT_WINDOW_SIZE.value;
    CONTEXT_WINDOW_SIZE.value = 50;
    try {
      const text = ANCHOR + " x".repeat(100) + " Bearer abc123token4567890xyz";
      // 100 字符间隔超过 50 半径,Bearer token 不应命中(锚点自身值仍在窗口内,属预期)
      expect(scanContextWindows(text).some((f) => f.category === "BEARER_TOKEN")).toBe(false);
    } finally {
      CONTEXT_WINDOW_SIZE.value = prev;
    }
  });
});
