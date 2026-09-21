# 实现：HIGH_ENTROPY 无标签凭据检测（默认关）

## Goal

补齐"无厂商前缀自建 token"漏检：新增默认关规则 `HIGH_ENTROPY`，用**自算**英文 bigram 交叉熵 + 长度插值阈值 + 多样性下限评分可疑随机串；附校准 fixtures 与 1M 上下文性能门槛。

## Background

- 依据：`archive/2026-09/09-21-eval-high-entropy`（结论 go，许可路径 B=自算表）。
- 缺口：现有 30+ 前缀规则与 PII 规则均漏"无标签随机值"；现有 Shannon 仅窄场景且对 hex/短串失准。
- 合规：**不使用 Cosy 数值表**；语料用公有领域文本（Project Gutenberg #1342 *Pride and Prejudice*，记录 URL+sha256），表与锚点自算并附生成脚本。

## Requirements

- R1 数据与许可：`scripts/gen-entropy-table.mjs` 读语料 → 平滑 bigram 代价表（−log2 概率，含 `^`/`$` 边界；数字与 letter→digit 转换按统一代价）→ 生成 `src/scanner/entropy-table.ts`（含 provenance 头：语料标题/URL/sha256/生成日期/脚本路径）。
- R2 算法（`src/scanner/entropy.ts`）：`tokenizeBlocks`（`[A-Za-z0-9]+`，len>8，排除纯数字，保留偏移）→ `entropyScore`（逐字符查表，按 len+1 归一）→ `isHighEntropyBlock`（多样性下限 `shannon >= min(2.5, log2(len)*0.72)` + 长度插值阈值）。
- R3 锚点**自校准**：`scripts/calibrate-entropy.mjs` 用留出语料与随机样本产出锚点（自然文本 FP ≤1% 的每长度阈值分位），结果常量入库；不得照搬竞品数字。
- R4 接入：`FindingCategory` 新增 `HIGH_ENTROPY`；`DEFAULT_RULE_TOGGLES` 默认 `false`；短码 `HIGHENT`；规则 UI 清单加入；`scanContextWindows` 全文调用（`isRuleEnabled` 关闭时零开销）。
- R5 校准/回归测试：
  - FP 门槛：留出自然语料（含仓库英文文档/注释抽样）块级 FP ≤1%；
  - 召回阶梯：随机 hex/base62（9/12/16/24/32 位）召回随长度递增（记录实测值）；
  - 反例集：中文文本、UUID、版本串、git SHA、纯数字、短串、base64 图像候选（`isBinaryPayload` 路径）、代码标识符样本。
- R6 性能（硬门槛）：
  - 基准测试（`src/__tests__/benchmarks/high-entropy-1mb.test.ts`）：1MB 文本，开启增量 ≤100ms；
  - 关闭时开销为零（不做任何扫描）；
  - 桌面实测：1MB 请求体经真实链路，对比开启/关闭的审计 duration。

## Acceptance Criteria

- [ ] AC1 正例命中：随机 hex/base62（≥16 位接近全命中）、含数字随机串命中；`{{HIGHENT_xxxxx}}` 占位符可还原。
- [ ] AC2 反例零命中：自然英文句/中文/UUID/版本串/SHA/纯数字/短串；默认关时不出任何 findings。
- [ ] AC3 校准门槛达成：留出语料 FP ≤1%；hex/base62 召回阶梯单调递增（数值写入任务 research）。
- [ ] AC4 性能：1MB 开启增量 ≤100ms（基准+桌面双证据）；关闭时 0 开销。
- [ ] AC5 `npm test` 全绿 + `npm run build` 绿；spec 记录规则边界（hash/标识符可能误报）与校准口径。

## Out of Scope

- 对现有 error_leak/context-key 的 Shannon 阈值改造；服务端词典/模型的语义检测（NER 另议）。
