# T1 探针证据与修复验证

## 1. 缺陷复现（修复前，临时探针 `src/__tests__/__probe-ct.test.ts`，已删除）

驱动方式：直接构造 route handler 请求，上游 mock 返回指定 content-type。

| content-type（上游返回） | 探针结果 | 判定 |
|---|---|---|
| `text/event-stream`（小写对照） | 首帧立即读出（responded） | 正常 |
| `Text/Event-Stream`（大写变体） | 挂起（500ms 超时未返回，缓冲路径等整流读完） | **缺陷①** |
| ` text/event-stream`（前导空白） | 立即读出 | 正常（`includes` 子串匹配不受前导空白影响） |
| `application/octet-stream`（小写对照） | 12B 字节原样 | 正常 |
| `Application/Octet-Stream`（大写变体） | 12B → 18B（UTF-8 解码替换字符） | **缺陷②** |

根因：`src/app/[...path]/route.ts` 响应侧两处 `contentType.includes("text/event-stream")`（finalizeUpstream 与 bypass 分支）与 `isBinaryContentType` 的大小写敏感匹配，是响应侧唯一未归一化的判定族（请求侧 `isMultipart`/`isJsonContentType` 已归一化）。

## 2. 修复内容

- 新增 `normalizeContentType`（小写+trim）、`isSseContentType`、`isBinaryContentType`（内部归一化）单一入口；两处 `.includes` 调用点改走 `isSseContentType`。
- 回归测试 `src/__tests__/response-content-type.test.ts`（4 用例）：大写 SSE 流式（用永不结束流 + 首帧读取锁增量语义，而非仅断言"不挂起"）、带空白 SSE 流式、大写 octet-stream 字节原样（含 0x89/0xff 非 UTF-8 字节）、小写对照。

## 3. 验证结果（修复后）

- `npm test`：548 passed | 1 skipped（549），57 文件全绿。
- `npm run build`：绿。
- 既有测试无回归（AC3）。

## 4. 留痕

- spec 已更新：`.trellis/spec/backend/reverse-proxy.md` §5 Gotcha——响应侧 content-type 判定必须归一化，入口为 `normalizeContentType`/`isSseContentType`/`isBinaryContentType`，禁止再内联裸 `includes`。
