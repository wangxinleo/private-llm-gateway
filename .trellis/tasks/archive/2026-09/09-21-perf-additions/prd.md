# 高熵检测 + 注入信号 + 回归补测（含 1M 上下文压力门槛）

## Goal

落地 T4/T6 评估结论的两项能力 + 补齐 F1 桌面回归边界，全部以满足"1M 上下文性能门槛"为硬性验收条件。

## Task Map

| # | 子任务 | 类型 | 依赖 |
|---|---|---|---|
| A | `09-21-high-entropy-rule` | 实现（HIGH_ENTROPY 规则，默认关） | 无 |
| B | `09-21-injection-signals` | 实现（请求侧注入信号 3 族，audit-only） | 无 |
| C | `09-21-regression-gap-verify` | 补测（multipart / 词库 UI 写 / reveal） | 无 |

## 跨子验收标准（性能为硬门槛）

- [ ] AC1 功能：A/B 全量测试绿 + build 绿；C 为真实链路证据（含截图/捕获）。
- [ ] AC2 **性能（1M 上下文）**：A 的规则开启时对 1MB 文本增量 ≤ 100ms；B 的分析对 1MB 文本增量 ≤ 80ms；两者同开时合计增量 ≤ 150ms（本机基准，基准测试与桌面实测各一份证据）。
- [ ] AC3 默认行为不回归：HIGH_ENTROPY 默认关（关闭时零开销）；注入信号默认开但 ≤ 预算且只记录不阻断。
- [ ] AC4 校准/负例：A 附自然语料 FP 门槛与 hex/base62 召回阶梯；B 附正例集与"仓库文本负例集（排除按设计枚举检测字面量的评估文档）"。
- [ ] AC5 每子任务：代码 + 证据 + 提交完成；无未提交残留。

## Notes

- 来源：`archive/2026-09/09-21-eval-high-entropy`（go）与 `09-21-eval-injection-signals`（go）的实施草图；边界来源 `09-21-fix-dedup-substring-leak/research/full-regression-report.md` §3。
- 合规：bigram 表**自算**（不使用 Cosy 数值表）；注入信号实现自研（竞品仅作设计参考）。
- 1M 压力测试：基准测试（vitest benchmarks）+ 真实链路桌面实测（1MB 请求体）双份证据。

## Final Integration Review（2026-09-21）

| 子任务 | 结论 | 提交 |
|---|---|---|
| 09-21-high-entropy-rule | 完成：默认关规则（自算表+自校准）；1M 基准增量 4.64ms、桌面 1.5MB +13~27ms；顺带修复 F-A1（Expect 头 502） | `811ca00` |
| 09-21-injection-signals | 完成：3 族 audit-only；1M 基准 0.63/1.69ms、桌面 1.58MB 57-67ms 且 3 信号落库 | `f96d3e6` |
| 09-21-regression-gap-verify | 完成：multipart 三例/词库 UI 写/reveal 两路；修复 F-C1（reveal 静默失败） | `671fb1f` |

跨子验收：AC1-A/B 全量 536 测试 + build 绿（C 为真实链路证据）；AC2 1M 门槛全部达成（A ≤100ms 实测 4.64ms 基准/+13~27ms 桌面；B ≤80ms 实测 0.63-1.69ms；合计远低于 150ms）；AC3 默认关零开销、注入只记录不阻断；AC4 校准与负例集齐备；AC5 全部提交归档。

压测附带发现（均已修复并带回归测试）：F-A1 `Expect: 100-continue` → undici 不支持 → 大请求 502；F-C1 reveal 错密码静默失败。
