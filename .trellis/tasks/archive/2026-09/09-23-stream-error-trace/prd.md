# 修复：上游/流式错误诊断增强

## Goal

对齐 maskit v0.4.0（`c7dc3ca`）的错误诊断教训：上游失败必须能区分「发请求时连接已死（resp=0，典型=复用的空闲连接被上游关掉）」与「上游已开始回包、中途断开（resp=1）」——两者现象都是 connection closed 但修法不同。现状：非流式 catch 只记 `fetch_failed (code)` + debug 详情、无审计痕迹；流式响应中途中断完全静默（`streaming.ts:71-73` 仅 `controller.error(err)`，无日志无审计）。补错误名/是否已开始回包/字节数/时长，落日志与审计信号。

## Requirements

- 统一诊断字段（唯一格式化入口 `src/proxy/error-trace.ts`）：
  - `err`：错误类型名（cause 名优先——undici fetch 的外层恒为 `TypeError`，无诊断价值；无 cause 时取外层名；非 Error 取 typeof）。
  - `code`：系统/undici 错误码（`ECONNRESET`/`UND_ERR_SOCKET`/`ENOTFOUND` 等，可缺省）。
  - `resp`：上游是否已开始回包（0=回包前失败；1=回包中途断开）。
  - `req`：请求体字节数；`out`：已入队下发的字节数（流式路径）。
  - `ms`：耗时（非流式=请求开始至今；流式=流建立至中断）。
- 两个非流式 catch（主链路 `route.ts` 主处理 + bypass 链路）：`log.warn` 携带诊断前缀；审计挂 `upstream_error` 信号（HIGH，只存元数据）；502 响应体保持 `{error:"upstream_error"}` 不变。
- 流式中断（`streaming.ts` catch）：先留痕（warn 日志 + analyzer 存在时挂 `upstream_error` 信号）再 `controller.error(err)`——客户端截断语义不变。
- 诊断只进日志/审计信号，绝不进客户端响应体；不得含正文、上游 URL、主机名、端口、错误消息（沿用 route-upstream-error 的零泄漏契约）。

## Acceptance Criteria

- [ ] AC1 复现测试先红后绿：修复前非流式失败与流式中断均无任何审计痕迹/诊断字段。
- [ ] AC2 非流式：forward 拒绝 → 502 + 信号 `{err,code,resp:0,req,ms}`；响应头已回但体读失败（缓冲路径）→ `resp:1`。
- [ ] AC3 流式：帧中途中断 → warn 日志 + 信号 `{err,resp:1,out,ms}`；无 analyzer 时不崩、截断语义不变。
- [ ] AC4 既有 502 契约与防泄漏测试不回归（`route-upstream-error.test.ts` 原 3 例保持绿）。
- [ ] AC5 `npm test` 全绿 + `npm run build` 绿；探针（mock 上游拒连 + SSE 中途断连）证据入任务 research。
- [ ] AC6 留痕只存元数据（err/code/resp/req/out/ms 数字与枚举），不得新增正文/明文落库面。

## Notes

- 借鉴合规：maskit 为 AGPL-3.0 **仅借鉴「诊断字段设计」思路，严禁复制代码**。
- 零拷贝透传路径（二进制/unknown 编码/bypass 非 SSE）的 body 由消费端直接泵送，不在本任务诊断面（既有边界，spec 记录）。
- 上游失败不改写既有 audit_log 行（信号挂本次请求，事件页展开可见）；不新增审计列。
