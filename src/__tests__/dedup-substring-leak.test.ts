import { beforeEach, describe, expect, it } from "vitest";
import { scanContextWindows } from "@/scanner/context-window";
import { applyMasks } from "@/scanner/pii";
import { runPipeline } from "@/scanner/pipeline";
import { MaskRegistry } from "@/scanner/mask-registry";
import { SCANNER_RULES, DEFAULT_RULE_TOGGLES } from "@/config";

const valuesOf = (text: string, category: string): string[] =>
  scanContextWindows(text)
    .filter((f) => f.category === category)
    .map((f) => f.matched);

const tagCount = (text: string, category: string): number =>
  (text.match(new RegExp(`\\{\\{${category}_`, "g")) ?? []).length;

// F1（2026-09-21 桌面验证）：scanContextWindows.push() 曾按值子串吸收去重（位置盲），
// 同值独立出现被丢弃 → 明文上行。以下用例锁定"独立出现逐处脱敏 + 精确去重保留"。
describe("F1: 去重不得按值子串吸收（独立出现必须脱敏）", () => {
  beforeEach(() => {
    Object.assign(SCANNER_RULES, DEFAULT_RULE_TOGGLES);
  });

  it("IPv6：fe80::1 独立出现 + fe80::1%eth0 两处都脱敏", () => {
    SCANNER_RULES.IPV6_PRIVATE = true;
    const text = "节点 fe80::1 与带zone fe80::1%eth0";

    // 扫描层：两个不同值都应产出 finding（不得互相吸收）
    expect(valuesOf(text, "IPV6_PRIVATE")).toEqual(["fe80::1", "fe80::1%eth0"]);

    // 管线层：转发体不得残留明文
    const result = runPipeline(text, text.length, [], new MaskRegistry());
    expect(result.maskedBody).not.toContain("fe80::1");
    expect(tagCount(result.maskedBody, "IPV6PRIV")).toBe(2);
  });

  it("既有规则：Luhn 卡号内含手机号 + 独立手机号都脱敏", () => {
    const text = "卡号 1380013800000003 与手机 13800138000";

    const pii = valuesOf(text, "PHONE");
    expect(pii).toContain("13800138000");
    expect(valuesOf(text, "BANK_CARD")).toContain("1380013800000003");

    const result = runPipeline(text, text.length, [], new MaskRegistry());
    expect(result.maskedBody).not.toContain("13800138000");
    expect(tagCount(result.maskedBody, "BANK_CARD")).toBe(1);
    expect(tagCount(result.maskedBody, "PHONE")).toBe(1);
    // 两个类别都进 findings（审计可见手机号被脱敏，而非只记银行卡）
    expect(new Set(result.findings.map((f) => f.category))).toEqual(new Set(["PHONE", "BANK_CARD"]));
  });

  it("保持性：同值跨来源（全量 pass + 窗口 pass）仍只记一条 finding", () => {
    // 手机号走全量 pass；同一文本又落在 api_key 锚点窗口内 → 不得重复
    const text = "api_key = aBcDeFgHiJkLmNoPqRsTuVwXyZ01234 电话 13912345678";
    expect(valuesOf(text, "PHONE")).toEqual(["13912345678"]);
    const all = scanContextWindows(text).filter((f) => f.matched === "13912345678");
    expect(all).toHaveLength(1);
  });

  it("保持性：同位置嵌套仅长值出现时，输出单个长值占位符（最长优先）", () => {
    const text = "卡号 1380013800000003";
    const registry = new MaskRegistry();
    const result = runPipeline(text, text.length, [], registry);

    // 卡与其中包含的手机号都是 finding，但替换只能发生一次（长值胜出）
    expect(result.maskedBody).toMatch(/^卡号 \{\{BANK_CARD_[bcdfghjkmnpqrstvwxz]{5}\}\}$/);
    expect(tagCount(result.maskedBody, "PHONE")).toBe(0);
  });

  it("顺序替换回退路径（>512 值）：短值在前也不得打碎长值", () => {
    const LONG = "1380013800000003";
    const SHORT = "13800138000";
    const registry = new MaskRegistry();
    const makeFinding = (matched: string, category: "PHONE" | "BANK_CARD") => ({
      category,
      action: "mask" as const,
      matched,
      maskTag: `{{${category}_xxxxx}}`,
    });

    // 短值排前 + 511 个不存在的占位 finding，强制走 applyMasksSequential
    const findings = [
      makeFinding(SHORT, "PHONE"),
      makeFinding(LONG, "BANK_CARD"),
      ...Array.from({ length: 511 }, (_, i) => makeFinding(`zz-dummy-${i}-absent`, "PHONE")),
    ];
    const text = `卡号 ${LONG}`;
    const result = applyMasks(text, findings, registry);

    expect(result.masked).toMatch(/^卡号 \{\{BANK_CARD_[bcdfghjkmnpqrstvwxz]{5}\}\}$/);
    expect(result.masked).not.toContain("0003");
  });
});
