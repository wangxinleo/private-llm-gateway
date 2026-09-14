import { describe, expect, it } from "vitest";
import { SseChannelRestorer, restoreText } from "@/proxy/restore";
import { MaskRegistry } from "@/scanner/mask-registry";

// 回溯防护基准:大量未完成 "{{" 前缀与长无标记文本,drain/restoreText 应近线性。
// 若引入灾难性回溯,此用例将显著超时(vitest 全局 120s,阈值 30s 留足余量)。
describe("restore backtracking safety", () => {
  it("handles 20k pathological frames with unclosed brace runs in bounded time", () => {
    const registry = new MaskRegistry();
    registry.tagFor("PHONE", "13800138000");
    const restorer = new SseChannelRestorer(registry);
    const payload = JSON.stringify({ choices: [{ index: 0, delta: { content: "x".repeat(200) + "{{{{{{{{" } }] });
    const frame = `data: ${payload}\n\n`;

    const start = performance.now();
    for (let i = 0; i < 20_000; i++) {
      restorer.pushBytes(frame);
    }
    restorer.flush();
    const elapsed = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`restore bench: 20k pathological frames in ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(30_000);
  });

  it("restoreText on large text with many partial candidates stays linear", () => {
    const registry = new MaskRegistry();
    registry.tagFor("PHONE", "13800138000");
    const text = ("lorem ipsum dolor sit amet ".repeat(40_000)) + "{{PHONE_";
    const start = performance.now();
    restoreText(text, registry);
    const elapsed = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`restoreText bench: ${(text.length / 1e6).toFixed(1)}MB in ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(30_000);
  });
});
