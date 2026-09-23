# T2 探针证据与修复验证

## 1. 缺陷复现（修复前，临时探针 `src/__tests__/__probe-size.test.ts`，已删除）

配置：`RUNTIME.maxBodyBytes = 1024`（模拟限额 1KB）；请求正文含手机号（触发 mask + 响应还原链路）。

| 探针 | 场景 | 修复前实测 | 判定 |
|---|---|---|---|
| P1 | 上游已发 4KB 且流永不 close（`application/json`） | POST 挂起（500ms 未返回——整流路径 `await upstream.text()` 等流结束） | **缺陷①**：超限响应阻塞整流 |
| P2 | 上游 4KB 有限响应（占位符在尾部） | 整读 + 整还原：响应含原文手机号；审计信号列表为空 | **缺陷②**：无体积闸、跳过无任何留痕 |

关键行：`route.ts:162-176` 缓冲路径全文读入 + `restoreText` + `analyzeResponse` 全同步执行，无上限、无痕迹。

## 2. 修复内容

- `readBodyCapped(body, limit)`：按上限封顶读取。越限即停（内存 ≤ 上限 + 单分片），已缓冲分片 + 剩余上游流重组为透传流（字节原样、顺序不变）。
- `content-length` 声明快速跳过：仅当编码为 `none`/`zstd`（声明值是可靠代理）且声明 > 上限时，不读 body 直接透传；`decoded`（gzip/br，undici 已解压、wire≠解码体积）不做快速跳过，避免误跳过。
- 留痕：`log.warn` + 审计信号 `restore_skipped`（MEDIUM，`detail={reason:"response_too_large", bytes, limit}`），挂本次请求 auditId。
- 透传头归一复用 `reemitUpstream` 契约（decoded 编码摘头；zstd 保留头由客户端解码）。

## 3. 验证结果（修复后）

- P1 翻转：超限永不结束流**立即返回**，字节可读。
- P2 翻转：超限响应**不还原**（占位符原样）+ `restore_skipped` 信号落库（reason/bytes/limit，无正文）。
- 对照：未超限响应照旧还原（占位符→原文）；`decoded` 编码声明值超限但实测未超限仍还原。
- 全量 `npm test` 绿 + `npm run build` 绿（详见提交信息）。
