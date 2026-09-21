# Design — 压缩响应链路

## 新增模块 `src/proxy/content-encoding.ts`

```ts
export const DECODED_BY_HTTP_CLIENT: ReadonlySet<string>; // gzip/x-gzip/deflate/br
export function filterAcceptEncoding(value: string): string;
// 逐 token 过滤(解析 ";" 前主 token,保留 q 参数原样); 支持集合内保留;
// 过滤后无 token → "identity"; 大小写不敏感。
export function classifyContentEncoding(headers: Headers): "none" | "decoded" | "zstd" | "unknown";
// none: 无头; decoded: 全部 token ∈ 客户端已解码集合(undici 已处理);
// zstd: 单/多 token 且全部为 zstd; unknown: 其余。
export function stripDecodedContentEncoding(headers: Headers): void;
// classify === "decoded" 时 delete("content-encoding")。
export function decodeZstdBuffer(buf: Uint8Array): string;         // zstdDecompressSync + utf8
export function decodeZstdStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array>;
// Readable.fromWeb(body).pipe(zlib.createZstdDecompress()) → Readable.toWeb
```

## 接入点

| 位置 | 变化 |
|---|---|
| `forwarder.ts` | 复制头后：`if (headers.has("accept-encoding")) headers.set(..., filterAcceptEncoding(raw))` |
| `streaming.ts` | `classifyContentEncoding`：decoded→删头（现行为）；zstd→`decodeZstdStream` 后再走 TextDecoder/restorer，删头；unknown→原样字节透传+保留头+log.warn（restorer/analyzer 不介入） |
| `route.ts finalizeUpstream` | a) SSE 无 registry / 二进制 / 无分析：`stripDecodedContentEncoding(headers)` 后 return（需要克隆头再返回）；b) 非流式读取路径：zstd→`decodeZstdBuffer` 得明文再还原/分析；unknown→log.warn + 原样返回（不还原）；decoded/none→现行为（读 text），响应头 `stripDecodedContentEncoding` |
| `route.ts` bypass 分支 | 非 SSE 返回前 `stripDecodedContentEncoding` |

注意：`return upstream` 直接复用 upstream 头时，需 `new Response(upstream.body, {status, headers})` 克隆头再改，避免改动上游对象头（上游 Response 头可改，但统一克隆更稳）。

## 测试设计（`src/__tests__/content-encoding.test.ts`）

- 单测：filterAcceptEncoding（缺失/常见组合/zstd 单列/q 参数/大小写/`*`）；classifyContentEncoding（none/decoded/zstd/unknown/混合）。
- 实链（`node:http` 本地服务器 + 真实 fetch）：
  1. gzip SSE：`new Response(upstream.body, {headers})` 经 `createStreamingResponse` → 文本完整、无 content-encoding；
  2. zstd SSE：同上 → 文本完整（走 zstd 解压分支）；
  3. zstd 非流式：`decodeZstdBuffer(await upstream.arrayBuffer())` → 原文。
- 防回归点：显式断言"输出头无 content-encoding 且文本含占位符原文"。

## 兼容/回滚

- 不改请求 body 语义；accept-encoding 过滤仅减少编码协商面（去掉 zstd），q 语义保留。
- 回滚：单模块 + 4 处调用，`git checkout` 即回。
