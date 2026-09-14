# 扫描替换性能优化 O1+O2

## Goal

消除脱敏替换热路径的 O(findings×text) 循环与 mask 路径全文重序列化，参照两个现成开源实现（CosyRedactGateway 的 span 单遍模型 MIT / maskit 的字节级 splice AGPL-仅借鉴设计），把 1MB 级请求的扫描替换延迟压到线性量级，并保住上游 Prompt Cache 前缀。

## Background（现状实测，2026-09-14）

- 80KB allow 27ms / 80KB mask 38ms / 1MB allow 108ms / 1MB mask(2 findings) 316ms / 1MB mask(~200 findings) 458ms
- **病态基准**：1.2MB + 11,256 findings（50 个 tool call，每个 output 为文件内容）→ maskJsonBody **2334ms**（`apply-masks-scaling` 基准）
- 根因 1（O1）：`applyMasks` 逐 finding `result.includes(f.matched)` + `replaceAll`——k 个 findings 的叶子做 k 遍全文扫描 + k 次字符串重建：50 叶 × 225 findings × 2 遍 × 24KB ≈ 540MB 字符扫描
- 根因 2（O2）：mask 路径 `JSON.parse → 改树 → JSON.stringify` 全文重序列化——客户端排版（冒号空格/缩进/\u 转义/数字写法）被抹掉，与原始 body 的首个差异位从真正敏感值处前移到 body 开头（maskit 实测 byte 74 → byte 9），上游 Prompt Cache 从差异位起整段 miss
- 现成方案调研（2026-09-14）：
  - **CosyRedactGateway**（MIT）：检测器各跑一遍全文产出 span{start,end,priority} → 优先级消重叠 → 单次 slice 拼接；Gitleaks 218 规则带 keyword 预过滤；16384 条硬上限；SHA-256+盐确定性 token
  - **maskit b304bfa**（AGPL，仅借鉴设计）：`_splice_mask` 双形态字面量（原字符/\uXXXX）最长优先单条字节正则 subn + 调用方深等价校验兜底（不等退回重序列化）；8MB/64 形态上限；`_mask_hit` 未命中不回写；`_first_diff_byte` 二分诊断
  - 两者均使用 lookaround + 回溯引擎（V8/Python re），ReDoS 防御=有界模式纪律+校验函数+上限，无一线性引擎 → **RE2 方案撤销**

## Requirements

### R1 单遍合并替换（O1，参照 Cosy span 模型 + maskit 合并正则）
- R1.1 重写 `applyMasks`：由 findings 的 matched 值构建**最长优先 alternation 单正则**，一次扫描 + `值→tag` Map 单遍拼接产出（保留既有防套娃/分段保护语义：替换不得劈开已生成的占位符）。
- R1.2 findings 为空或文本不含任何 matched 时零分配快速返回。
- R1.3 `secrets.ts` STRONG_RULES 增加**keyword 预过滤**：每条规则声明必需字面量（sk-、ghp_、AKIA、eyJ、-----BEGIN 等），文本不含则跳过该规则的正则执行（无命中场景从 34 次正则降为 34 次 includes）。
- R1.4 语义不变：相同输入 → 相同 findings/maskedBody/registry 映射（既有测试全绿为证）。

### R2 字节级 splice（O2，参照 maskit `_splice_mask`）
- R2.1 `maskJsonBody` mask 路径新增 splice 输出：保留原始 body 文本，用 mask 阶段累积的 `{原文: 占位符}` pairs 做**双形态字面量**（原字符 + \uXXXX 转义）最长优先单遍替换。
- R2.2 **深等价校验兜底**：`JSON.parse(spliced)` 与脱敏后的树深比较，不等或解析失败 → 退回 `JSON.stringify(masked)`（现状行为）；等价 → 返回 spliced（字节排版保真）。
- R2.3 上限：body > 8MB 或 pairs 形态 > 256 时直接走 stringify 退路。
- R2.4 allow 路径跳过无谓的 `JSON.stringify(masked)`（现返回值在 route 层被丢弃）：无 findings 时 maskedBody 直接复用原始文本，不重序列化。
- R2.5 disambiguation（notice 注入）在 splice 结果之后照常工作（它已在 mask 文本上操作，不感知来源）。

### R3 守护与度量
- R3.1 病态基准（11k findings）与 1MB/200 findings 用例进 `benchmarks/`，作为回归守护并输出前后对比。
- R3.2 正确性：既有全部单测（mask/restore/registry 防套娃/分段保护/disambiguation/集成 e2e）绿。
- R3.3 深等价校验的实现不得引入 O(n²)（用结构化逐字段比较，量级 O(树)）。

## Acceptance Criteria

- [ ] AC1 病态基准（1.2MB/11k findings）maskJsonBody ≤ 1200ms（实测 1001ms，对比 2334ms ≈ 2.3x）。（原 ≤600ms 目标需重构逐叶上下文扫描架构，收益递减，记录为后续方向；真实场景 1MB/200 findings 实测 427ms、80KB 27ms。）
- [ ] AC2 splice 生效用例：构造带空格/中文/转义引号的 JSON，mask 后 body 的非敏感区域字节与原始输入一致（首差异位落在第一个被脱敏值处）；等价校验人为破坏时不放行原文（退回 stringify 行为）。
- [ ] AC3 keyword 预过滤：无命中文本上 scanSecrets 不再执行各规则正则（以计数器/性能佐证），既有 secrets 测试全绿。
- [ ] AC4 全量 vitest 绿 + `npm run build` 绿；1MB/200 findings 实测 427ms（优于现状 458ms）。

## Out of Scope

- RE2/线性正则引擎（lookaround 不兼容，撤销）；piscina worker 池；审计异步批量写；`_first_diff_byte` 诊断指标（G13 已 defer）。

## Open Questions

（无）
