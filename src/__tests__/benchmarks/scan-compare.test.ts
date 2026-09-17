import { describe, it, expect } from "vitest";
import { runPipeline } from "@/scanner/pipeline";
import { scanSecrets } from "@/scanner/secrets";
import { scanContextKey } from "@/scanner/context-key";
import { scanPii } from "@/scanner/pii";

function benchmark(fn: () => void, iterations = 20): number {
  fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6 / iterations;
}

function buildPayload(sizeBytes: number): string {
  const prose =
    "The quick brown fox jumps over the lazy dog. See https://api.example.test/v1 for the public documentation. " +
    "The commit sha is abcdef1234567890abcdef1234567890abcdef12. BasicFlow is a dataflow library. " +
    "For more details visit https://docs.example.test/guide and review the architecture overview. ";
  const chunks: string[] = [];
  let size = 0;
  while (size < sizeBytes) { chunks.push(prose); size += prose.length; }
  chunks.push("\nuser wangxinleo endpoint https://app.ccload.com/v1\n");
  return chunks.join("");
}

function oldFullScan(text: string): number {
  return [...scanSecrets(text), ...scanContextKey(text), ...scanPii(text)].length;
}

describe("benchmark: old full-scan vs new window-scan", () => {
  it("278KB payload", () => {
    const payload = buildPayload(278 * 1024);
    const oldMs = benchmark(() => oldFullScan(payload));
    const newMs = benchmark(() => runPipeline(payload, payload.length).findings.length);
    const oldFindings = oldFullScan(payload);
    const newResult = runPipeline(payload, payload.length);
    // eslint-disable-next-line no-console
    console.log(`\npayload: ${(payload.length / 1024).toFixed(1)} KB`);
    // eslint-disable-next-line no-console
    console.log(`old full-scan: ${oldMs.toFixed(1)} ms | new window-scan: ${newMs.toFixed(1)} ms | speedup: ${(oldMs / newMs).toFixed(2)}x`);
    // eslint-disable-next-line no-console
    console.log(`findings old vs new: ${oldFindings} vs ${newResult.findings.length}`);
    // 性能断言:新窗口扫描应快于旧全文扫描(AC5)
    expect(newMs).toBeLessThan(oldMs);
  });
});
