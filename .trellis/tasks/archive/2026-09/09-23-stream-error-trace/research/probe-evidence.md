# T4 探针证据：上游/流式错误诊断（2026-09-23）

方法：复现测试先红 → 实现 → 单测/全量绿；standalone 网关（隔离 DB_PATH）+ mock 上游实测三条路径，DB 信号与网关日志双向核对。

## 1. 复现（实现前，`npx vitest run src/__tests__/upstream-error-trace.test.ts`）

3 红 1 绿：非流式拒连与缓冲路径读体失败均**无任何审计信号**（`upstreamErrorSignal()` 返回 undefined）；SSE 帧中途断连无信号、无日志（仅 `controller.error`）。第 4 例（无 analyzer 中断）为行为守卫，修复前后均绿。

## 2. 关键发现 T4-AP1：`return finalizeUpstream(...)` 的 rejection 不进 catch

复现测试第 2 例（缓冲路径读体失败）在修复前以**未捕获 SocketError 直接炸出 `POST()`**（而非预期的 502）。探针定位（临时插桩，已还原）：

```
[TRACE] before finalize call
[TRACE] readBodyCapped threw: SocketError
POST REJECTED: SocketError terminated        ← catch 未命中
```

根因：`return <promise>` 在 async 函数里不 await，promise 的 rejection 由 async 机制接管，**不经过 try/catch**。改动 `await finalizeUpstream(...)` 后同路径即进 catch（`[TRACE] catch hit: SocketError` → 502）。
影响面：缓冲路径的「上游已回包、体读中途失败」（正是 maskit 教训里 `resp=1` 的场景）、zstd 解码失败、还原/落库异常，此前全部变成未捕获异常（生产表现为 500 + 无审计线索）。

## 3. 实测（standalone :3100 + mock 上游 :8787，隔离 DB）

请求体统一含手机号（触发 mask，registry 非空）：

| # | 场景 | 客户端观察 | 审计信号（DB） |
|---|---|---|---|
| 1 | `/buffered-abort`（JSON 头+部分体后销毁连接） | **502** `{"error":"upstream_error"}`（修复前为未捕获异常） | `upstream_error · HIGH {"err":"SocketError","resp":1,"ms":68.7,"code":"UND_ERR_SOCKET","req":79}` |
| 2 | `/stream-abort`（SSE 2 帧后销毁连接） | 首帧已还原下发 `first 13812345678`，随后 `curl: (18) transfer closed` | `upstream_error · HIGH {"err":"SocketError","resp":1,"ms":62.2,"code":"UND_ERR_SOCKET","out":63}` |
| 3 | 上游进程已下线（拒连） | 502 `{"error":"upstream_error"}` | `upstream_error · HIGH {"err":"Error","resp":0,"ms":1.5,"code":"ECONNREFUSED","req":79}` |

网关 warn 日志（三条路径各有诊断前缀）：

```
WARN [proxy] POST /buffered-abort | upstream error: fetch_failed [err=SocketError code=UND_ERR_SOCKET resp=1 req=79B ms=68.7]
WARN [streaming] stream aborted mid-response [err=SocketError code=UND_ERR_SOCKET resp=1 out=63B ms=62.2]
WARN [proxy] POST /v1/chat/completions | upstream error: fetch_failed [err=Error code=ECONNREFUSED resp=0 req=79B ms=1.5]
```

`resp` 判别力实测成立：#1/#2（上游已回包后断）resp=1 且带 code=UND_ERR_SOCKET；#3（回包前连接已死）resp=0 code=ECONNREFUSED——正是 maskit 09-20 排查卡住的两类。

零泄漏核对：502 响应体恒为 `{"error":"upstream_error"}`，`8787`/`127.0.0.1`/`ECONNREFUSED` 均不出现（响应侧断言 + 探针复核）。诊断仅存于日志与审计信号（元数据：类型名/错误码/resp/req/out/ms，无正文、无消息、无地址）。

## 4. 回归面

- 新增 `src/__tests__/upstream-error-trace.test.ts` 7 例：诊断字段格式化 3 例 + 非流式 2 例（含 T4-AP1 的 resp=1 场景）+ 流式 2 例（含无 analyzer 守卫）。
- `npm test`：572 通过 | 1 跳过（60 文件，T3 后 566 → +7 例，1 例原为 565+1）；
- `npm run build`：exit 0（首次因 `interface` 不满足 `Record<string, unknown>` 隐式索引签名报错，改 `type` 别名后通过）。
- 既有 502 契约与零泄漏用例（`route-upstream-error.test.ts` 3 例）保持绿。
