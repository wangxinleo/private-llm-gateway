import { describe, expect, it, vi } from "vitest";
import { collectEnvWarnings, warnInvalidEnv } from "@/lib/env-check";
import { initializeConfigs } from "@/config-loader";

describe("env 校验告警", () => {
  it("合法值零告警(含旧值 prefix/json-meta)", () => {
    expect(
      collectEnvWarnings({
        PRIVACY_MASK_FORMAT: "legacy",
        PRIVACY_DISAMBIGUATION_MODE: "off",
        PRIVACY_SECRET_SCANNER_MODE: "strict",
        PRIVACY_DEBUG_HEADERS: "true",
        DISABLE_ORIGIN_CHECK: "1",
        TRUST_PROXY: "1",
        PRIVACY_SUFFIX_SECRET: "0123456789abcdef",
      })
    ).toEqual([]);
    expect(collectEnvWarnings({ PRIVACY_DISAMBIGUATION_MODE: "prefix" })).toEqual([]);
    expect(collectEnvWarnings({ PRIVACY_DISAMBIGUATION_MODE: "json-meta" })).toEqual([]);
  });

  it("未设置/空串不告警", () => {
    expect(collectEnvWarnings({})).toEqual([]);
    expect(collectEnvWarnings({ PRIVACY_MASK_FORMAT: "" })).toEqual([]);
  });

  it("拼写错误逐个告警,含实际值/期望值/回退行为", () => {
    const warnings = collectEnvWarnings({
      PRIVACY_MASK_FORMAT: "Legacy",
      PRIVACY_DISAMBIGUATION_MODE: "Off",
      PRIVACY_SECRET_SCANNER_MODE: "Strict",
      PRIVACY_DEBUG_HEADERS: "yes",
      DISABLE_ORIGIN_CHECK: "true",
      TRUST_PROXY: "true",
    });
    expect(warnings.length).toBe(6);
    const joined = warnings.join("\n");
    expect(joined).toContain('PRIVACY_MASK_FORMAT="Legacy"');
    expect(joined).toContain("semantic");
    expect(joined).toContain('PRIVACY_DISAMBIGUATION_MODE="Off"');
    expect(joined).toContain('DISABLE_ORIGIN_CHECK="true"');
    expect(joined).toContain("来源校验保持开启");
    expect(joined).toContain('TRUST_PROXY="true"');
  });

  it("短 PRIVACY_SUFFIX_SECRET（<16）告警并说明后果", () => {
    const warnings = collectEnvWarnings({ PRIVACY_SUFFIX_SECRET: "short-secret" });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("PRIVACY_SUFFIX_SECRET");
    expect(warnings[0]).toContain("Prompt Cache");

    expect(collectEnvWarnings({ PRIVACY_SUFFIX_SECRET: "exactly-16-chars" })).toEqual([]);
  });

  it("warnInvalidEnv 经 stderr(console.warn)输出并返回告警列表", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const warnings = warnInvalidEnv({ PRIVACY_MASK_FORMAT: "bogus" });
      expect(warnings.length).toBe(1);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain("PRIVACY_MASK_FORMAT");
    } finally {
      spy.mockRestore();
    }
  });

  it("initializeConfigs 首次调用输出告警,二次调用不重复（once 守卫）", () => {
    const saved = process.env.PRIVACY_MASK_FORMAT;
    process.env.PRIVACY_MASK_FORMAT = "Bogus";
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      initializeConfigs();
      const first = spy.mock.calls.length;
      initializeConfigs();
      expect(first).toBeGreaterThan(0);
      expect(spy.mock.calls.length).toBe(first);
    } finally {
      spy.mockRestore();
      if (saved === undefined) delete process.env.PRIVACY_MASK_FORMAT;
      else process.env.PRIVACY_MASK_FORMAT = saved;
    }
  });
});
