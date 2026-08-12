import { describe, it, expect } from "vitest";
import { maskJsonBody } from "../src/scanner/json-mask";
import { runPipeline } from "../src/scanner/pipeline";
import { readFileSync, existsSync } from "fs";

function benchmark(fn: () => void, iterations = 3): number {
  fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6 / iterations;
}

describe("perf regression gate: real captured request (1.18MB)", () => {
  // 真实请求.md 为敏感抓包,不入库;缺失时跳过(CI/他人环境无此文件)
  it("maskJsonBody on real payload stays under 5s", { skip: !existsSync("真实请求.md") }, () => {
    const body = readFileSync("真实请求.md", "utf8");
    const payload = body.slice(body.indexOf("{"));

    const t = benchmark(() => maskJsonBody(payload, (t, s) => runPipeline(t, s)), 3);
    const result = maskJsonBody(payload, (t, s) => runPipeline(t, s));
    // eslint-disable-next-line no-console
    console.log(`real payload: ${(payload.length / 1024 / 1024).toFixed(2)} MB`);
    // eslint-disable-next-line no-console
    console.log(`findings: ${result.findings.length} | action: ${result.action}`);
    // eslint-disable-next-line no-console
    console.log(`maskJsonBody (REAL): ${t.toFixed(1)} ms`);

    // 当前基线 4272ms;修复后应显著下降。此断言防止灾难回溯回归(<5s 是宽松门槛)
    expect(t).toBeLessThan(5000);
  });
});