import { beforeEach, describe, expect, it } from "vitest";
import { scanHighEntropy, isHighEntropyBlock } from "@/scanner/entropy";
import { scanContextWindows } from "@/scanner/context-window";
import { runPipeline } from "@/scanner/pipeline";
import { MaskRegistry } from "@/scanner/mask-registry";
import { SCANNER_RULES, DEFAULT_RULE_TOGGLES } from "@/config";

const RANDOM_HEX_24 = "a3f9c2e51b7d4860ff23ab91";
const RANDOM_B62_32 = "q7X9v2L5m8N4r6T1w3Y0z5A8b2C9d7F4";
const RANDOM_MIXED_16 = "kx9f2m4p7q1z8t3w";

describe("HIGH_ENTROPY 规则（默认关）", () => {
  beforeEach(() => {
    Object.assign(SCANNER_RULES, DEFAULT_RULE_TOGGLES);
  });

  it("默认关:随机串不产生 findings", () => {
    expect(DEFAULT_RULE_TOGGLES.HIGH_ENTROPY).toBe(false);
    expect(scanHighEntropy(`token ${RANDOM_HEX_24}`)).toEqual([]);
  });

  it("开启后命中无标签随机串(hex/base62/混合)", () => {
    SCANNER_RULES.HIGH_ENTROPY = true;
    const values = scanHighEntropy(`a=${RANDOM_HEX_24} b=${RANDOM_B62_32} c=${RANDOM_MIXED_16}`).map((f) => f.matched);
    expect(values).toContain(RANDOM_HEX_24);
    expect(values).toContain(RANDOM_B62_32);
    expect(values).toContain(RANDOM_MIXED_16);
    expect(scanHighEntropy("x").every((f) => f.category === "HIGH_ENTROPY")).toBe(true);
  });

  it("反例:自然词/中文/UUID/版本串/纯数字/短串/重复串", () => {
    SCANNER_RULES.HIGH_ENTROPY = true;
    for (const text of [
      "the responsibility of understanding internationalization", // 自然词
      "这里是一段中文说明文字，不应命中",
      "id 550e8400-e29b-41d4-a716-446655440000", // UUID(连字符拆分后各段不达标)
      "version 1.2.3-beta.4 build 20260921",
      "count 12345678901234567890",
      "short abc12345", // 恰好 8 位
      "repeat ababababababab",
      "aaaaaa aaaaaaaa",
    ]) {
      expect(scanHighEntropy(text), text).toEqual([]);
    }
  });

  it("哈希守卫:标准长度纯小写 hex 不判(含 git SHA-1/sha256),其它形态照常判", () => {
    SCANNER_RULES.HIGH_ENTROPY = true;
    const sha1 = "d670460b4b4aece5915caf5c68d12f560a9fe3e4"; // 40 hex
    const sha256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"; // 64 hex
    expect(sha1).toHaveLength(40);
    expect(sha256).toHaveLength(64);
    expect(scanHighEntropy(`${sha1} ${sha256}`)).toEqual([]);
    // 大写 hex 不落入守卫(哈希罕见大写;自建 token 常见混合大小写)
    const upper = sha256.toUpperCase();
    expect(scanHighEntropy(upper).map((f) => f.matched)).toContain(upper);
  });

  it("超长连续块（>256）跳过:base64 大 blob 不入列", () => {
    SCANNER_RULES.HIGH_ENTROPY = true;
    const blob = "b".repeat(100) + RANDOM_B62_32.repeat(6); // 292 字符
    expect(blob.length).toBeGreaterThan(256);
    expect(scanHighEntropy(blob)).toEqual([]);
  });

  it("管线端到端:命中经脱敏为 HIGHENT 占位符并可还原", () => {
    SCANNER_RULES.HIGH_ENTROPY = true;
    const registry = new MaskRegistry();
    const body = `token=${RANDOM_HEX_24} phone=13800138000`;
    const result = runPipeline(body, body.length, [], registry);
    expect(result.action).toBe("mask");
    expect(result.maskedBody).toContain("{{HIGHENT_");
    expect(result.maskedBody).toContain("{{PHONE_");
    expect(result.maskedBody).not.toContain(RANDOM_HEX_24);
    expect(registry.size).toBe(2);
  });

  it("窗口扫描接入:scanContextWindows 在开关关闭时零命中、开启时命中", () => {
    const text = `payload ${RANDOM_B62_32}`;
    expect(scanContextWindows(text).some((f) => f.category === "HIGH_ENTROPY")).toBe(false);
    SCANNER_RULES.HIGH_ENTROPY = true;
    expect(scanContextWindows(text).some((f) => f.category === "HIGH_ENTROPY")).toBe(true);
  });

  it("isHighEntropyBlock 单元语义", () => {
    SCANNER_RULES.HIGH_ENTROPY = true;
    expect(isHighEntropyBlock(RANDOM_HEX_24)).toBe(true);
    expect(isHighEntropyBlock("short")).toBe(false);
    expect(isHighEntropyBlock("1234567890")).toBe(false);
  });
});
