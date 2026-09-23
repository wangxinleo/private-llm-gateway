# 探针证据：09-23 批次 E2E 验证发现（FAIL）

验证日期 2026-09-23，范围 09-23 批次四项（T1/T2/T3/T4）集成 HEAD。harness 与原始证据保留在 `/tmp/v23-verify/`（mock 上游 :8787、网关 :3100、审计库、日志、bench 脚本、expected/got 二进制）。

复现方法总览：

```bash
node /tmp/v23-verify/mock-upstream.mjs &            # mock 上游 :8787
DB_PATH=/tmp/v23-verify/audit.sqlite UPSTREAM_URL=http://127.0.0.1:8787 ADMIN_KEY=devkey \
  DISABLE_ORIGIN_CHECK=1 DEBUG=1 PORT=3100 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

（`RUNTIME.maxBodyBytes` 默认 MAX_BODY_MB=1 → 1048576；可用 `PUT /api/admin/config {"key":"MAX_BODY_MB","value":...}` 热更。）

---

## F1（critical）正则 O(n²) 回溯 → 事件循环挂起

**复现**：

```bash
curl --max-time 12 -s -o /dev/null -w "%{http_code} %{time_total}s\n" \
  "http://127.0.0.1:3100/edge-at?ch=a"   # mock 返回 1MB 纯小写词串 JSON
timeout → 网关无响应；期间 dashboard（/api/admin/*）一切请求同样阻塞
```

- 挂起现象：curl 12s 超时无响应，再次请求任何路由均无响应；进程 CPU ~99.6% 单核。
- `sample <pid>` 栈（/tmp/v23-verify/sample.txt，累计 2567 采样 ≈ 25.7s 全在同一栈）：

```
Builtins_StringPrototypeReplace (in node)
  → v8::internal::Runtime_RegExpExecMultiple(...)
    → v8::internal::NativeRegExpMacroAssembler::Match(...)
```

即 `restore.ts` 的 `strict.replace(LOOSE_RX, ...)`（restore.ts:24）在长词串上回溯爆炸，占用唯一事件循环。

**根因（micro-bench，/tmp/v23-verify/regex-bench.mjs，`text.matchAll(rx)` 计时）**：

| 输入（n 个重复字符） | pre-batch LOOSE | post-batch LOOSE | post RESIDUAL_TAG_RX |
|---|---|---|---|
| 10,000 × `'A'` | 50.8ms | 39.6ms | 38.1ms |
| 20,000 × `'A'` | 223.7ms (×4.4) | 155.6ms (×3.9) | 152.1ms (×4.0) |
| 40,000 × `'A'` | 800.3ms (×3.6) | 633.2ms (×4.3) | 581.7ms (×3.8) |
| 40,000 × `'a'` | **0.0ms**（大写锚点不触发） | 581.7ms | 581.1ms |
| 40,000 × `'-'` | — | 0.0ms | 0.0ms |

规模翻倍耗时 ×4 → 明确 O(n²)。形态 `[A-Za-z][a-z...]*_` 的标签体量词无界（`[A-Za-z0-9_]*`），在无空白长 run 上每个起始位置都做全长扫描后失败。

- 批前形态 `/\{{0,2}[A-Z][A-Z0-9_]*_[...]{5}\}{0,2}/g` 同样二次方，但只对**大写开头** run 触发（存量隐患）；
- T3 `placeholder-scan.ts` 与 T1 放宽后的 `LOOSE_CORE` 用 `[A-Za-z]` 开头 → **小写长 run 也触发**，暴露面显著扩大（真实流量：base64/json 小写长串、URL、长 token）。默认 32MB 上限内可达。

**影响面**：单事件循环进程 → 一条 1MB 词串响应即可 DoS 全网关（个人使用场景=自己也打不开 dashboard）。

**修复方向**（PRD F1）：标签体量词收紧为 `[A-Za-z][A-Za-z0-9_]{0,12}`（`MAX_SHORTCODE_LEN`=12，最长真实短码 `PRIVATE_KEY`=11），有界回溯 → 线性；配性能护栏测试。

---

## F2（high）越限 decoded 透传带 stale content-length → 客户端静默截断

**复现**：

```bash
curl -s -D headers-big-gzip.txt -o got-big-gzip.bin http://127.0.0.1:3100/big-gzip
```

mock `/big-gzip` 响应头 `content-encoding: gzip`、wire `content-length: 2117`，解码后 2,100,039 字节（> 1MB 限，触发 T2 跳过）。

实测：

- 响应头（headers-big-gzip.txt）：`content-length: 2117` 原样保留。
- `got-big-gzip.bin` = **2117 字节**（= wire CL），`exp-big-gzip.bin` = 2,100,039 字节；前缀一致 —— 客户端按 CL 读满即停，静默截断，无任何报错。
- 对比 none 路径：`/big-json`（2,200,039B）字节日级一致 ✅、`/edge-over`（1,048,577B）一致 ✅ —— 因为 none 的 wire CL = 解码体积，保留是对的。

**根因**：undici 自动解压 gzip/br 但不改 header；T2 新增 oversized 分支（`finalizeUpstream`，route.ts ~249）用解码后的 `capped.stream` 重新 `new Response(...)`，headers 只经 `reemitUpstream` 的 `stripDecodedContentEncoding`（删 content-encoding），**未删 content-length**。同函数内正常还原路径（~285）有 `headers.delete("content-length")`，此分支漏做。

**修复方向**（PRD F2）：oversized 分支仅当 `encoding === "decoded"` 时删 CL 再包装；none/zstd 保持（其 CL 是可靠 wire 体积）。

---

## F3（medium）客户端主动断开被记 HIGH upstream_error

**复现**：

```bash
curl --max-time 2 http://127.0.0.1:3100/sse-mixed   # mock 每帧后 hold 3s，curl 2s 主动断开
```

日志（gateway.log）：

```
WARN [streaming] stream aborted mid-response [err=TypeError code=ERR_INVALID_STATE resp=1 out=62B ms=1505.2]
```

审计 signals：`upstream_error / HIGH / {"err":"TypeError","resp":1,"code":"ERR_INVALID_STATE","out":62}` —— 客户端正常取消被标为上游故障，污染信号面（F3 结论：误报）。

对比真实上游中断 `/sse-abort`（mock 主动 destroy）：`[err=SocketError code=UND_ERR_SOCKET resp=1 out=70B ms=303.8]` —— 二者当前形态难以区分；上游类型差异恰好不同（TypeError@cancel vs SocketError），但同为 HIGH。

**根因**：`streaming.ts` 下游 ReadableStream 只有 `pull` 无 `cancel` 钩子；客户端取消时 `controller.error(err)` 路径与上游异常共用 catch，无来源标记。

**修复方向**（PRD F3）：下游 `cancel()` 打标记 `clientCancelled`；catch 中客户端取消 → debug 日志、不写 signal、不 `controller.error`；上游中断维持现行为。

---

## 相关既有行为（回归基线，修复不得破坏）

- T2 跳过留痕：`restore_skipped` 三例正常（big-json 2200039B/29ms、edge-over 1048577B、big-gzip 1064960B）。
- 边界 exactly-1MB（空格填充 `/edge-at?ch=+`）：25ms 正常还原 ✅（未踩 F1，因 run 被空格打断）。
- T3 计数：`restore_count=2 / degraded=1 / unresolved=1 / samples=["PHONE_zzzzq"]`，`placeholder_residual` signal 一致；NULL≠0 语义正确。
- T1：大小写混合 SSE 立即流式（1.5s 内 2 帧、还原 `13812345678`）；混合大小写二进制 12B 与纯小写对照逐字节一致。
- T4：err500 原样透传；buffered-abort → 502 且进程存活；ECONNREFUSED `resp=0 req=89B` 7ms。
- 杂音：Next.js 在 SSE 断开后打印自身 `⨯ Error: failed to pipe response ... SocketError other side closed`（框架行为，非本项目日志）。

## mock 上游端点速查（/tmp/v23-verify/mock-upstream.mjs）

| 端点 | 行为 |
|---|---|
| `/v1/chat/completions` | 回显 `${tag} + {${core}} + PHONE_zzzzq`（含真实签发标签与未签发标签） |
| `/sse-mixed` | `Text/Event-Stream`（非规范大小写），2 帧后 hold 3s |
| `/bin-mixed` `/bin-lower` | 12 字节 PNG 魔数（大小写混合 contentType 对照） |
| `/big-json` | 2.2MB JSON（none） |
| `/edge-at` `/edge-over` | 恰好 1MB / 1MB+1；`?ch=<c>` 换填充字符（`a` 触发 F1） |
| `/big-gzip` | gzip，解码 2.1MB（触发 F2） |
| `/err500` `/sse-abort` `/buffered-abort` | T4 场景 |
