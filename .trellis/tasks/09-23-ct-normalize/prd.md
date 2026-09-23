# 修复：响应 content-type 判定归一化（SSE 挂起/二进制损坏）

## Goal

响应侧 content-type 判定统一归一化（小写+去空白）后再匹配，修复两个实测缺陷：`Text/Event-Stream` 致响应挂起（不走流式）、`Application/Octet-Stream` 致二进制响应体被 UTF-8 解码破坏。

## Background

- 竞品依据：maskit v0.4.0 `2a657cf` 新增测试 `test_response_content_type_accepts_any_case`——大小写敏感判据致整段响应不还原，被其定为「响应侧唯一一处没做 lower() 的判据」。
- 我方探针实测（2026-09-23，临时探针已删除，工作区干净；证据见父任务 `research/competitor-update-09-23.md` §2.1 M1）：
  - `src/app/[...path]/route.ts:129`、`:313`：`contentType.includes("text/event-stream")` 大小写敏感；`route.ts:81-82` `isBinaryContentType` 正则/后缀匹配同样敏感。
  - `Text/Event-Stream` + 永不结束的 SSE 流 → POST 挂起（走缓冲路径 `await upstream.text()`，等整条流读完才返回）。
  - `Application/Octet-Stream` + 12B 二进制 → 响应体变 18B（UTF-8 解码替换字符），不可逆破坏。
  - 对照：`text/event-stream`/`application/octet-stream` 正常；带前导空白的 ` text/event-stream` 正常（`includes` 不受前导空白影响）。

## Requirements

- R1 SSE 判定归一化：`finalizeUpstream` 与 bypass 分支（`route.ts:312-313`）取上游 content-type 后先 `toLowerCase().trim()` 再判定。
- R2 二进制判定归一化：`isBinaryContentType` 内部归一化（对大小写不敏感）。
- R3 不改变正常路径行为：小写/带参数的常规 content-type 行为与修复前完全一致。
- R4 探针转正为回归测试：SSE 大写→流式（立即返回且不阻断）、SSE 带空白→流式、二进制大写→字节原样、二进制小写对照→字节原样；另含「大写 SSE 首帧可增量读出」断言（锁流式语义而非仅不挂起）。

## Acceptance Criteria

- [ ] AC1 `Text/Event-Stream` 响应立即返回且走流式（首帧可增量读取），不再等待整流完成。
- [ ] AC2 `Application/Octet-Stream` 响应体字节与上游完全一致（含 0x89/0xff 类非 UTF-8 字节）。
- [ ] AC3 反例：小写对照与既有测试全绿（无行为回归）。
- [ ] AC4 `npm test` 全绿 + `npm run build` 绿。

## Out of Scope

- 请求侧 content-type 判定（`isMultipart`/`isJsonContentType` 已归一化，无缺陷）；响应体体积上限（另立 T2）。
