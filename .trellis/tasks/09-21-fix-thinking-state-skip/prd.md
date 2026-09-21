# 修复：请求侧模型推理状态被脱敏（thinking/reasoning）

## Goal

请求侧扫描不再改写"上游自产模型状态"字段（Anthropic thinking/redacted_thinking、Chat reasoning_content 系列、Responses reasoning/compaction），避免签名失效导致上游 400；其余内容脱敏行为完全不变。

## Background

- 竞品依据：CosyRedactGateway 2026-09-18 `fix: preserve request-side model reasoning state`（协议 + 路径 + 角色感知；字段名单独不构成豁免）。
- 我方实测（09-21 临时探针，已删除、工作区已恢复干净）：
  - Anthropic assistant `thinking` 文本中的手机号被脱敏为 `{{PHONE_zqfvk}}`；
  - 自定义词命中 thinking（`AcmeCorp` → `{{PROJECT_rvpfg}}`）——项目名/代号是模型思考里的高频词，属最常见现实触发；
  - thinking 块 signature 覆盖 thinking 内容，改写即验签失败 → 多轮 extended thinking 上游 400。
- 我方现状：`src/scanner/json-mask.ts` `scanValue` 对所有字符串无差别扫描，唯一豁免 `isBinaryPayload`（data URI / `data` 键长 base64）。

## Requirements

- R1 跳过面（协议 + 路径 + 角色 + 类型多重感知，全部满足才跳过）：
  - Anthropic Messages：`messages[i]` 为 assistant 且 content 块 `type ∈ {thinking, redacted_thinking}` → 跳过整个内容块（含 thinking/signature/data）；
  - OpenAI Chat：`messages[i]` 为 assistant 且键 `∈ {reasoning_content, reasoning, reasoning_details}` → 跳过该子树；
  - OpenAI Responses：`input[i]` 项 `type ∈ {reasoning, compaction}` → 跳过该项。
- R2 绝不引入"按字段名豁免"：同名字段出现在非法路径/角色下仍照常扫描。
- R3 跳过不产生 findings、不铸造占位符、不进 registry；响应侧还原与响应分析不受影响。
- R4 回归测试：三类协议正例 + 反例（assistant 普通 text 块、tool_use input、user 文本、非法路径同名字段仍被扫描）。

## Acceptance Criteria

- [ ] AC1 探针转正：thinking 内 custom-word / phone 两用例断言 thinking 字段字节不变（无占位符）。
- [ ] AC2 反例全过：不跳过路径命中行为与修复前一致。
- [ ] AC3 `npm test` 全绿 + `npm run build` 绿。

## Out of Scope

- 响应侧 reasoning/thinking 通道还原（已实现，不动）；跳过行为的开关化（协议语义，不加开关）；NER 二阶段检测（另有评估任务）。

## Open Questions

（无）
