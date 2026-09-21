import { describe, it, expect, afterAll } from "vitest";
import { scanHighEntropy } from "@/scanner/entropy";
import { scanContextWindows } from "@/scanner/context-window";
import { SCANNER_RULES, DEFAULT_RULE_TOGGLES } from "@/config";

// 1M 上下文性能门槛（PRD R6）：HIGH_ENTROPY 开启时增量 ≤100ms；关闭时零开销。
// 断言留有余量（CI 机器差异），实测值打印在日志中作为证据。

function benchmark(fn: () => void, iterations = 3): number {
  fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6 / iterations;
}

const MB = 1024 * 1024;

function buildText(bytes: number): string {
  const sentence =
    "The privacy proxy scans the request body before forwarding it upstream. " +
    "请把配置里的网关地址换成内网节点，日志里出现 13800138000 与 sk-abc12345 时按规则处理。 " +
    '{"model":"gpt-4o","messages":[{"role":"user","content":"deploy with token a3f9c2e51b7d4860ff23ab91"}]} ';
  const rngParts = ["q7X9v2L5m8N4r6T1w3Y0z5A8b2C9d7F4", "kx9f2m4p7q1z8t3w", "3f7b2a9c4e1d8f60"];
  const parts: string[] = [];
  let size = 0;
  let i = 0;
  while (size < bytes) {
    const chunk = sentence + rngParts[i++ % rngParts.length] + " ";
    parts.push(chunk);
    size += chunk.length;
  }
  return parts.join("");
}

const saved = { ...SCANNER_RULES };

afterAll(() => {
  Object.assign(SCANNER_RULES, saved);
  Object.assign(SCANNER_RULES, DEFAULT_RULE_TOGGLES);
});

describe("benchmark: HIGH_ENTROPY 1MB", () => {
  it("关闭时零开销（内部门控短路），开启时增量 ≤100ms", () => {
    const text = buildText(MB);
    console.log(`\ntext: ${(text.length / 1024).toFixed(0)} KB`);

    SCANNER_RULES.HIGH_ENTROPY = false;
    const offDirect = benchmark(() => scanHighEntropy(text));
    const offPipeline = benchmark(() => scanContextWindows(text));

    SCANNER_RULES.HIGH_ENTROPY = true;
    const onDirect = benchmark(() => scanHighEntropy(text));
    const onPipeline = benchmark(() => scanContextWindows(text));

    const delta = onPipeline - offPipeline;
    console.log(`high-entropy off: direct=${offDirect.toFixed(2)}ms pipeline=${offPipeline.toFixed(2)}ms`);
    console.log(`high-entropy on : direct=${onDirect.toFixed(2)}ms pipeline=${onPipeline.toFixed(2)}ms`);
    console.log(`增量(direct)=${onDirect.toFixed(2)}ms  增量(pipeline)=${delta.toFixed(2)}ms`);

    expect(offDirect).toBeLessThan(5);
    expect(onDirect).toBeLessThan(150);
    expect(delta).toBeLessThan(150);
  });
});
