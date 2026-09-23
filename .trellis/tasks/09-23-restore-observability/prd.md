# 实现：响应还原可观测性（计数 + 样本 + 落库 + 面板）

## Goal

响应侧还原从「零可见」变为可查：本次响应还原了几处、降级修复几处、未还原几处（含样本 token），落审计行并在事件页展示；计数面与检测/修复面同宽（容忍形态不漏报），且不双计。

## Background

- 竞品依据：maskit `c7dc3ca` 真机教训三连（见父任务 research §2.1 M3）：① 计数面不能窄于检出面（`{{ EMAIL_x }}` 加空格、`{{email_x}}` 小写标签全漏 → 「页面满屏未还原、事件页只报 1」）；② 转义遍双计（宽松量词允许 0 个反斜杠 → 同一形态两遍各计一次，判据改为整段判定、只排除计数不提前 return）；③ 无会话孤儿只数不还原（补建会话=拆安全门）。
- 我方对照（代码级）：
  - `restore.ts` `restoreText` 只统计 `degraded`（宽松遍命中），**未命中占位符（unresolved）完全不计数**；`SseChannelRestorer.getDegraded()` 为死代码。
  - 审计条目（`AuditEntry`/`audit_log`）只有请求侧 mask 字段（maskApplied/maskCategories/maskCount），**响应侧还原零可见**：还原几处、几处没还原、什么形态，无处可查。
  - `response-analysis.ts` 的 `placeholder_residual` 信号用严格 `TAG_RE` 计数（计数面窄于检出面，同 maskit 教训①）。
  - 多轮场景客户端重发原文会自然重注册；但「响应里出现当前 registry 查不到的 token」（上游改写、跨进程重启、客户端带入历史 token）是盲区。

## Requirements

- R1 检测器单一实现：新增 `src/scanner/placeholder-scan.ts` 的 `findResidualPlaceholders(text)`——容忍形态（1-2 重花括号 + 花括号内可选空白 + 标签大小写不敏感 + 已知标签白名单），排除 notice 示例占位符（模型回显 notice 属常态），返回 `{count, samples≤5}`（samples 只含 token 本身，不含任何明文）。
- R2 计数：`RestoreStats` 扩展为 `{restored, degraded}`——`restored` = 本次替换的占位符出现次数（严格 + 宽松），`degraded` = 其中经宽松遍修复的次数（现有语义保留）。`SseChannelRestorer.getStats()` 替换死代码 `getDegraded()`（含 drain 严格命中计数）。
- R3 未还原计数：对「还原后输出」做一次 `findResidualPlaceholders` 扫描（流式在分析器累积的已发出文本上，≤2MB 截断；非流式在整流文本上）。单遍扫描天然不双计；未被还原的容忍形态（含 `{{ PHONE_x }}`/`{{phone_x}}`）计入。
- R4 修复面与计数面同宽：宽松遍（`LOOSE_RX`）扩展到容忍花括号内空白与标签大小写，命中时按规范化 core（trim + 标签大写）查 registry，命中即还原并计 degraded；未命中原样保留（由 R3 计为未还原）。修复只在 registry 命中时发生——零泄漏风险。
- R5 落库：`audit_log` 增列 `restore_count` / `restore_degraded` / `restore_unresolved` / `restore_samples`（JSON ≤5，全部可空=未发生还原遍，如零拷贝/超限跳过），ALTER TABLE 迁移对齐 mask_* 列；响应完成后 UPDATE 本行并广播 `audit_update`（实时面板按 id 合并，不重复插行）。
- R6 面板：审计行展开区展示「响应还原」块——还原 N · 降级 D · 未还原 U + 未还原样本 badges；i18n zh/en；API row 映射新增四字段（samples 为占位符本身，无需 reveal 门）。
- R7 `response-analysis.ts` 的 `placeholder_residual` 信号改用共享检测器（计数面=检出面，教训①落在信号侧）；notice 豁免与既有断言不回归。
- R8 覆盖流式与非流式两路：非流式在 `finalizeUpstream` 整流还原后落库；流式由 `StreamResponseAnalyzer.finish()` 在流结束时落库（restorer 统计 + 累积文本扫描）。

## Acceptance Criteria

- [ ] AC1 检测器单测：严格/缺括号/花括号内空白/小写标签全命中；未知标签与非法后缀不命中；notice 示例豁免；samples ≤5 去重且不含明文。
- [ ] AC2 计数正确不双计：同一响应混合「严格命中 + 空格形态 + 缺括号形态 + 未发行 token」→ restored/degraded/unresolved 与预期一致（如 3/2/1）；宽松形态修复只在 registry 命中时发生。
- [ ] AC3 落库与流式：非流式与 SSE 两种路径的响应，审计行 `restore_*` 四列与样本正确（重启跨进程孤儿 → unresolved>0 且样本含 token）；零拷贝/超限跳过路径四列为空。
- [ ] AC4 面板：`audit_update` 事件驱动实时行合并（按 id），展开区显示计数与样本；`npm test` 全绿 + `npm run build` 绿。
- [ ] AC5 既有行为不回归：`response_poison.placeholder_residual` 信号、notice 豁免、还原语义（strict 优先）与既有测试全绿；spec 增补 Gotcha。

## Out of Scope

- 无会话孤儿「只数不还原」的跨会话兜底表（maskit 方案③）：我方 sid 概念在扩展链路，网关侧无会话，孤儿判定=registry 查不到即计入未还原（样本可见），不引入全局复用表。
- 空 registry / legacy 格式的零拷贝透传路径不做扫描（保持热路径零开销；是否计数=是否发生还原遍）。
- CSV 导出新增列、按未还原数筛选（无需求）。
