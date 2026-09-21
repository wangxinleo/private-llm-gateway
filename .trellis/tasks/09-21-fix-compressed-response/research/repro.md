# 复现证据（2026-09-21 实测，Node v22.15.0 / undici 内置 fetch）

## 1. undici 对压缩响应的行为

本地 `node:http` 服务器分别返回 gzip/zstd/br，客户端 `fetch` 读取：

| 编码 | 响应头 content-encoding | body 读取结果 |
|---|---|---|
| gzip | `gzip`（**保留**） | 已自动解压为明文 |
| br | `br`（保留） | 已自动解压为明文 |
| zstd | `zstd`（保留） | **未解压**，原样 zstd 字节 |

结论：undici 解压 gzip/deflate/br 但不摘头；zstd 完全不处理。

## 2. 头体错配复现（模拟我方非流式/透传路径）

网关侧 `await upstream.text()`（已解压明文）→ `new Response(明文, {headers: 上游头})`（不删 content-encoding）→ 客户端收到 `content-encoding: gzip` 的明文：

```
client sees content-encoding: gzip
client body read error: terminated          # undici 客户端按 gzip 解压明文失败
strict gunzip of plain text: incorrect header check
```

## 3. 影响路径（源码坐标，2026-09-21）

- `src/app/[...path]/route.ts:115`（SSE 无 registry 透传）、`:125/127`（二进制/无分析透传）、`:143-149`（非流式重建，仅删 content-length）、`:287`（bypass 非流式）
- `src/proxy/streaming.ts:10`（无条件删头：对 gzip 正确、对 zstd 会把未解压字节当明文输出）
- 转发侧 `forwarder.ts` 原样复制客户端 `accept-encoding`（含 zstd）→ 触发上游返回 zstd 的条件

## 4. 触发条件

客户端（Chromium 系 Cursor/Edge 等）宣告 `accept-encoding: gzip, deflate, br, zstd`；上游/CDN 支持并选择压缩（gzip/br 即触发头体错配；zstd 触发解码失败）。Node SDK 客户端不宣告压缩，因此本地自测不易暴露——属"真实客户端才触发"的盲区。
