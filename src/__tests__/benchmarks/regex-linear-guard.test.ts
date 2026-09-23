import { describe, expect, it } from "vitest";
import { restoreText } from "@/proxy/restore";
import { findResidualPlaceholders } from "@/scanner/placeholder-scan";
import { MaskRegistry } from "@/scanner/mask-registry";

// 线性护栏(2026-09-23 E2E 发现):LOOSE_RX/RESIDUAL_TAG_RX 的标签体量词曾无界
// (`[A-Za-z][A-Za-z0-9_]*_`),在无空白长词串上每个起始位都全长扫描后失败 → O(n²):
// 实测 40KB 纯小写 run 耗时 581ms、100KB 约 3.6s、1MB 分钟级(事件循环冻结)。
// 收紧为 {0,MAX_SHORTCODE_LEN} 后有界回溯 → 线性。阈值 1000ms 对 100KB:二次方
// 形态必然超时(≈3.6s),线性形态余量 ~100×,不受 CI 抖动影响。
const RUN_LEN = 100_000;
const LINEAR_BUDGET_MS = 1_000;

describe("标签正则线性护栏:长词串不得触发二次方回溯", () => {
  it("restoreText 在 100KB 纯小写词串上线性完成", () => {
    const registry = new MaskRegistry();
    registry.tagFor("PHONE", "13800138000");
    const text = "a".repeat(RUN_LEN);

    const start = performance.now();
    const out = restoreText(text, registry);
    const elapsed = performance.now() - start;

    // eslint-disable-next-line no-console
    console.log(`restoreText linear guard: ${RUN_LEN / 1000}KB word-run in ${elapsed.toFixed(1)}ms`);
    expect(out).toBe(text);
    expect(elapsed).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it("restoreText 在 100KB 纯大写词串上线性完成(存量隐患同拦)", () => {
    const registry = new MaskRegistry();
    registry.tagFor("PHONE", "13800138000");
    const text = "A".repeat(RUN_LEN);

    const start = performance.now();
    const out = restoreText(text, registry);
    const elapsed = performance.now() - start;

    // eslint-disable-next-line no-console
    console.log(`restoreText uppercase linear guard: ${RUN_LEN / 1000}KB in ${elapsed.toFixed(1)}ms`);
    expect(out).toBe(text);
    expect(elapsed).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it("findResidualPlaceholders 在 100KB 纯小写词串上线性完成", () => {
    const text = "a".repeat(RUN_LEN);

    const start = performance.now();
    const result = findResidualPlaceholders(text);
    const elapsed = performance.now() - start;

    // eslint-disable-next-line no-console
    console.log(`residual scan linear guard: ${RUN_LEN / 1000}KB word-run in ${elapsed.toFixed(1)}ms`);
    expect(result.count).toBe(0);
    expect(elapsed).toBeLessThan(LINEAR_BUDGET_MS);
  });
});
