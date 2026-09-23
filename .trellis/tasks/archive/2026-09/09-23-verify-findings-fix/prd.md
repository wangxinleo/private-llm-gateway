# 本地验证发现缺陷修复：正则回溯挂起 / 越限透传截断 / 客户端中断误报

## Goal

09-23 批次本地 E2E 验证（FAIL 结论）暴露 3 个缺陷，逐一修复：

- **F1（critical）正则回溯挂起**：`LOOSE_RX`（mask-tag.ts）与 `RESIDUAL_TAG_RX`（placeholder-scan.ts）中 `[A-Za-z][A-Za-z0-9_]*_` 形态在长词串（无空白长 run）上 O(n²) 回溯，1MB 词串响应可冻结整个事件循环（含 dashboard）。T3 把计数面从「大写开头」扩到 `[A-Za-z]` 后暴露面变大；实际为存量隐患（修复前 `/\{{0,2}[A-Z][A-Z0-9_]*_/g` 同样形态，小写 run 不触发）。
- **F2（high）越限透传静默截断**：T2 新增的 oversized 分支把解码后（undici 已解压）的 body 重新包装透传，却保留上游 wire `content-length`（gzip 压缩体积），客户端按 CL 截断——实测 2.1MB 解码体只收到 2117B，前缀字节一致、无报错。
- **F3（medium）客户端中断误报**：客户端主动断开（curl --max-time 等）在 streaming.ts 被记为 HIGH `upstream_error` 审计信号，与真实上游故障无法区分。

修复纪律：先复现（红）后修复（绿）；三项均须有回归测试钉死。

## Requirements

### F1 正则线性化

- `src/scanner/mask-tag.ts` `LOOSE_CORE` 与 `src/scanner/placeholder-scan.ts` `TAG_CORE`：把标签体量词从无界 `[A-Za-z0-9_]*` 收紧为有界 `{0,N}`，N 取 `MAX_SHORTCODE_LEN`（12，最长真实短码 `PRIVATE_KEY`=11）。
- 收紧后每个匹配尝试为有界回溯 → 线性；须保证既有全部正确性用例（含容忍形态 `{{ EMAIL_x }}`、`{{email_x}}` 小写、裸 token、LOOSE/严格两遍行为）不回归。
- `TAG_PARTIAL_RE`（流式边界回退）同源形态，一并核查处理。
- 新增性能护栏测试：大词串（≥150KB 纯 `[A-Za-z0-9_]` run）在宽松遍 + 残留扫描下必须快速完成（线性量级，秒级预算内），二次方形态会耗时数分钟——用超时/耗时断言钉死。

### F2 越限透传去 stale CL

- `src/app/[...path]/route.ts` `finalizeUpstream` oversized 分支：仅 `encoding === "decoded"`（gzip/br 已被 undici 解压，wire CL ≠ 解码体积）时删除 `content-length` 再包装透传；`none`/`zstd` 的 CL 是可靠 wire 体积，维持现状。
- 不得改变 T2 既有跳过路径行为：快速跳过（声明 CL > 限）与 capped 透传（none/zstd）字节一致性保持。
- 回归测试：gzip 响应解码体积 > 限 → 客户端收到完整解码体（无截断），且无 stale CL；none/zstd 跳过路径回归不变。

### F3 客户端中断分类

- `src/proxy/streaming.ts`：为下游 ReadableStream 增加 `cancel` 钩子标记 `clientCancelled`；catch 中若为客户端取消 → 仅 debug 日志，不写 `upstream_error` 信号、不 `controller.error`；上游诱发的中断维持现行为（trace + signal）。
- 回归测试：reader.cancel() 后无 `upstream_error` 信号、无 "stream aborted" warn；上游中断路径不变。

### 共同

- 三处修复均补 `.trellis/spec/backend/reverse-proxy.md` Gotchas（有界量词、capped 透传禁带 stale CL、client-cancel 与上游中断区分）。
- `npm test` + `npm run build` 全绿。

## Acceptance Criteria

- [x] AC1（F1 红转绿）：性能护栏测试修复前 100KB 词串 3541ms（二次方）→ 修复后 2.2–2.7ms（线性）；入 `npm test` 套件（`benchmarks/regex-linear-guard.test.ts`）。
- [x] AC2（F1 正确性）：mask-tag / placeholder-scan / restore 既有用例全绿；容忍形态（空格内衬、小写标签、裸 token）行为不变。
- [x] AC3（F2）：限 1MB 下 `/big-gzip` 交付 2,100,039B 完整解码体（与 mock 直产字节一致），响应头无 content-length（chunked）；`restore_skipped` 留痕（bytes=1064960/limit=1048576）与 none 路径 `/big-json`（2,200,039B 逐字节一致、CL 保留）不变。
- [x] AC4（F2 红转绿）：新增用例修复前保留 wire CL "2117"（红）→ 修复后为 null（绿）。
- [x] AC5（F3）：客户端 curl --max-time 取消 → 审计仅 `response_poison/MEDIUM`，无 HIGH `upstream_error`；日志出现 `DEBUG [streaming] client cancelled stream mid-response (out=62B, ms=1468.1)`、无 "stream aborted" warn。对照 `/sse-abort`（上游 destroy）仍记 `upstream_error/HIGH {"err":"SocketError","code":"UND_ERR_SOCKET","resp":1,"out":70}`。
- [x] AC6（E2E 复验）：`/edge-at?ch=a`（1MB 小写词串）114ms 返回 1,048,572B（修复前 12s 挂死）；`?ch=A` 116ms；期间 dashboard 管理接口 3ms 可响应。
- [x] AC7：`npm test` 62 文件 / 578 通过 | 1 跳过；`npm run build` exit 0；spec Gotchas 新增三条（有界量词 / decoded 透传去 stale CL / client-cancel 分类）。

## 验证记录（2026-09-23 修复后 E2E，harness 同 /tmp/v23-verify）

限 1MB（PUT max_body_mb=1），网关 `node .next/standalone/server.js` :3100 + mock :8787：

| 探针 | 结果 |
|---|---|
| `/edge-at?ch=a` 1MB 小写词串 | 200 / 1,048,572B / **0.114s**（修复前 12s 超时挂死，事件循环冻结） |
| `/edge-at?ch=A` 1MB 大写词串 | 200 / 1,048,572B / 0.116s（存量隐患同修） |
| `/edge-at?ch=+` 空格填充（边界恰好 1MB） | 200 / 1,048,572B / 0.016s（还原路径回归不变） |
| `/big-gzip` 解码 2.1MB（decoded 越限） | 200 / **2,100,039B 完整**（修复前仅 2117B 截断）/ 响应头无 content-length（chunked）/ 字节与 mock 直产一致 / `restore_skipped` 留痕 |
| `/big-json`（none 声明跳过快路径） | 2,200,039B 逐字节一致，content-length 保留 |
| `/edge-over?ch=a`（none capped 透传） | 1,048,577B 逐字节一致，content-length 保留 |
| `/sse-mixed` curl --max-time 1.5 取消 ×3 | 审计仅 `response_poison/MEDIUM`（echo 未签发标签属真信号）；全库唯一 `upstream_error` 属 `/sse-abort`；debug 日志 `client cancelled stream mid-response (out=62B, ms=1468.1)`，无 stream aborted warn |
| `/sse-abort`（上游 destroy 对照） | `upstream_error/HIGH {"err":"SocketError","code":"UND_ERR_SOCKET","resp":1,"out":70}` 保持 |
| `/v1/chat/completions` 还原 | echo 还原为 `13812345678 + 13812345678 + PHONE_zzzzq`；`restore_count=2 / unresolved=1 / samples=["PHONE_zzzzq"]`（T3 语义不变） |
| `/bin-mixed` vs `/bin-lower`（T1） | 12B 逐字节一致，混合大小写 contentType 原样透传 |
| `/err500`（T4） | 500 + 原始体原样透传 |

复跑注意：跳过路径断言内容长度前，需先 `PUT /api/admin/config {"key":"max_body_mb","value":1}`——默认 32MB 下 `big-gzip` 落在 within 路径（会还原而非跳过）；字节对照需用当前进程标签（`PRIVACY_SUFFIX_SECRET` 未固定时后缀每进程随机），从响应中提取标签后经 mock `/__echo-payload` 重建期望体。

## Out of Scope

- 不改 T1/T2/T3/T4 的既有功能语义（content-type 归一化、体积闸阈值、还原计数、错误诊断格式）。
- 不引入全局扫描性能优化（如流式分块扫描/worker 化）——本轮只做形态收紧与正确性/护栏修复。
- 不动上游 undici 解压策略与 T2 阈值默认值。

## Notes

- 证据与复现步骤见 `research/probe-evidence.md`（本任务目录）与 /tmp/v23-verify（mock 上游、审计库、日志、bench 脚本）。
- F1 根因定位依据：`sample` 栈（RegExpExecMultiple → macro assembler）与 micro-bench（`'A'*40KB+'_'` 777.6ms / 修复前小写 0.0ms / 扩宽后小写 611.1ms / `'-'` 0.0ms）。
