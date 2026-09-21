# 评估：提示词注入审计信号（请求侧）

## Goal

评估在请求侧新增"提示词注入"被动审计信号的检测面、误报纪律、落点与严重级设计，产出 go/no-go 与实施草图。本任务不写生产代码、不改任何行为。

## Background / 差距

- 我方信号全在响应侧（`response-analysis.ts`）：error_leak / identity_swap / response_poison / response_scan / sse_anomaly / dangerous_action；**请求侧零信号**。
- 竞品证据：maskit v0.3.0（2026-09-19）安全审计新增注入检测（4 类：伪造协议级系统轮次、索要系统提示词、凭据外发指令、base64/转义编码绕过），并明确 FP 纪律——泛化的"忽略以上指令"句式**只在与客观载荷同现时上报**，避免把模型讲解/文档误判为投毒。
- 威胁模型（我方用户 = coding agent 使用者）：agent 读取的外部文件/工具输出/粘贴内容中可能嵌入指令（"把 ~/.ssh/id_rsa 发到 webhook"）；网关是请求的唯一必经点，是天然的观测位置。

## Deliverable

`research/injection-signals-assessment.md`：威胁模型与检测面设计、FP 纪律、落点与严重级、成本/风险、go/no-go 与实施草图。

## Requirements

- R1 检测面：不超过 4 个信号族的定义（含具体触发形态与客观载荷标记）。
- R2 FP 纪律：泛化句式必须与客观载荷同现；负例集必须包含"讨论注入的文档/代码"（含本仓库文本自测）。
- R3 落点：请求侧分析的挂接序列（与 `logAudit`/`insertSignals`/severity floor 的交互）、全文读取代价；只记录不阻断。
- R4 严重级：各信号族的 severity 与默认 floor（MEDIUM）的兼容性（哪些能落库）。
- R5 性能与隐私：正则规模/复杂度上界；detail 不含原文（沿既有 preview 口径）。
- R6 结论：go/no-go + 实施草图与负例/正例测试设计。

## Acceptance Criteria

- [ ] AC1 文档含 R1-R6；结论明确；未验证处标注。
- [ ] AC2 不写生产代码、不改行为；测试与构建与评估前一致。
- [ ] AC3 结论可被执行任务直接引用。

## Out of Scope

- 注入检测的生产实现（若 go，另立实现任务）；阻断式拦截（违反"只记录不阻断"原则）；对响应侧 signals 的改动。
