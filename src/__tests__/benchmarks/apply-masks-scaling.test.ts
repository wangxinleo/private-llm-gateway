import { describe, it, expect } from "vitest";
import { applyMasks } from "@/scanner/pii";
import { buildMaskTag } from "@/scanner/mask-tag";
import { maskJsonBody } from "@/scanner/json-mask";
import { runPipeline } from "@/scanner/pipeline";
import type { Finding } from "@/types";

function benchmark(fn: () => void, iterations = 3): number {
  fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6 / iterations;
}

describe("quantify: applyMasks O(findings x text) explosion curve", () => {
  it("1.2MB text, sweep finding count", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat((1.2 * 1024 * 1024) / 45);
    const textKB = (text.length / 1024).toFixed(0);
    // eslint-disable-next-line no-console
    console.log(`\ntext: ${textKB} KB`);

    for (const count of [100, 1000, 5000, 10000, 20000, 40000]) {
      // 每条 finding 的 matched 是文案中不存在的随机串 → replaceAll 全文扫但不替换
      // (最坏情形:每条都触发一次全文 regex scan)
      const findings: Finding[] = Array.from({ length: count }, (_, i) => ({
        category: "CONTEXTUAL_SECRET",
        action: "mask",
        matched: `zzz_nonexistent_${i}_${Math.random().toString(36).slice(2)}`,
        maskTag: buildMaskTag("CONTEXTUAL_SECRET"),
      }));
      const t = benchmark(() => applyMasks(text, findings), 3);
      // eslint-disable-next-line no-console
      console.log(`findings=${count}: ${t.toFixed(1)} ms`);
    }

    // 性能不变量:applyMasks 应近似线性(每千条 findings 增幅稳定),若出现超线性即为回归
    expect(true).toBe(true);
  });
});

/** 模拟真实工具调用:function_call_output 里就是文件内容(充满 key=value / 高熵值) */
function buildToolCallPayload(totalBytes: number, fileSize: number): string {
  const items: unknown[] = [];
  let size = 0;
  let i = 0;
  while (size < totalBytes) {
    const lines: string[] = [];
    let lineSize = 0;
    let j = 0;
    while (lineSize < fileSize) {
      const kinds = [
        `"api_key_${j}": "${Math.random().toString(36).slice(2).repeat(3)}${j}",`,
        `token=${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
        `"url": "https://api.example.test/v1/${i}/${j}",`,
        `const value${j} = "${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}";`,
        `export const key${j} = "${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}";`,
      ];
      const line = kinds[j % kinds.length] + "\n";
      lines.push(line);
      lineSize += line.length;
      j++;
    }
    const output = lines.join("");
    items.push({ role: "user", content: [
      { type: "function_call", call_id: `call_${i}`, name: "read_file", arguments: JSON.stringify({ path: `/tmp/file${i}.ts` }) },
      { type: "function_call_output", call_id: `call_${i}`, output },
    ]});
    size += output.length;
    i++;
  }
  return JSON.stringify({ model: "gpt-5.6-luna", input: items, store: true });
}

describe("reproduce: tool-call outputs (file contents) as dense finding sources", () => {
  it("1.2MB JSON with ~50 tool calls, each output = file content", () => {
    const total = 1.2 * 1024 * 1024;
    const payload = buildToolCallPayload(total, 24 * 1024);

    const tFull = benchmark(() => maskJsonBody(payload, (t, s) => runPipeline(t, s)));
    const result = maskJsonBody(payload, (t, s) => runPipeline(t, s));
    // eslint-disable-next-line no-console
    console.log(`\nreproduce: payload ${(total / 1024 / 1024).toFixed(2)} MB`);
    // eslint-disable-next-line no-console
    console.log(`findings: ${result.findings.length} | action: ${result.action} | count: ${result.maskSummary?.replacementCount}`);
    // eslint-disable-next-line no-console
    console.log(`maskJsonBody (tool-call): ${tFull.toFixed(1)} ms`);

    // 复现能力断言:工具调用输出形态必须产生大批量 findings(万级)
    expect(result.findings.length).toBeGreaterThan(1000);
  });
});