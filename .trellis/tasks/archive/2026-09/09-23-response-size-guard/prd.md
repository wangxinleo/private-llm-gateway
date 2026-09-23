# 修复：响应体还原体积闸 + 跳过留痕

## Goal

非流式响应「全文读入 + 同步还原/分析」加响应侧体积闸：超限跳过还原/分析、响应体字节不动，并留可查痕迹（事件/日志），杜绝超大响应占住事件循环。

## Background

- 竞品依据：maskit `2a657cf` 新增 `_MAX_RESPONSE_RESTORE_BODY=32MB`（与请求侧对齐），超限不改 body、跳过还原，但必须 `_emit_skip(reason="response_too_large")` 留痕——否则用户看到裸占位符以为引擎坏了、事件页却无线索；两条测试分别钉「不得改 body」与「必须留痕」（`test_oversized_json_response_skips_restore_but_leaves_a_trace`）。
- 我方对照（代码级）：请求侧有 32MB 闸（`route.ts:238/255` + 413），**响应侧完全无上限**——`finalizeUpstream` 缓冲路径 `await upstream.text()`（zstd 走 `arrayBuffer()`）+ `restoreText` + `analyzeResponse` 全同步执行（`route.ts:162-176`），响应侧还原/分析零可见痕迹。

## Requirements

- R1 体积闸（响应侧）：缓冲路径读取前先定上限 `RUNTIME.maxBodyBytes`（复用请求侧 32MB/`MAX_BODY_MB`，不新增 env）。两类判定：
  - 声明体积快速跳过：`content-length` 声明且编码为 `none`/`zstd` 时（声明值可靠代理），声明 > 上限 → 不读 body，直接透传（省 32MB 级无效读）。
  - 实测体积封顶读：其余情况按上限封顶读取；越过上限即停止累积，把「已缓冲分片 + 剩余上游流」重组为透传流。不再 `await upstream.text()` 整读；内存占用有界（≤ 上限 + 单分片）。
  - `decoded`（gzip/br，undici 已解压）不做声明值快速跳过：wire 体积≠解码体积，避免"声明超限但解码后很小"的误跳过。
- R2 字节不动：跳过时响应体字节与上游完全一致（分片顺序不变、不解码不重编码）；头归一规则与既有透传一致（decoded 编码摘 `content-encoding`；zstd 保留头由客户端解码）。
- R3 留痕：跳过必须留痕且不含正文——`log.warn`（服务端日志）+ 审计信号 `restore_skipped`（severity MEDIUM，`detail={reason:"response_too_large", bytes, limit}`，只有数字）。信号挂在本次请求 auditId 上，事件页展开即可见。
- R4 先复现后修复：探针先证明现状（超限响应在限额 1KB 配置下被整读整还原；永不结束的超限流致请求挂起），修复后翻转为「跳过 + 留痕 + 字节完整」。
- R5 不改变正常路径行为：未超限响应照旧还原/分析；SSE、二进制、unknown 编码、零拷贝透传路径不受影响。

## Acceptance Criteria

- [ ] AC1 超限响应（永不结束流）立即返回且字节可读（不再整流挂起）；有限超限响应字节与上游逐字节一致。
- [ ] AC2 超限时**不还原**（响应保留占位符原样）且写入 `restore_skipped` 信号（reason/bytes/limit，无正文）；未超限对照仍正常还原。
- [ ] AC3 `decoded` 编码不被 content-length 声明误跳过（声明超限、实际解码后未超限 → 仍还原）。
- [ ] AC4 既有测试全绿 + `npm test` 全绿 + `npm run build` 绿；spec 增补 Gotcha。

## Out of Scope

- 流式（SSE）路径的累计体积限制（逐帧还原内存天然有界；maskit 的限制同样只作用于整流路径）。
- 响应侧还原计数/样本（T3）；错误诊断前缀（T4）。
