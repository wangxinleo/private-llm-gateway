# 修复：压缩响应链路（content-encoding 头错配 / zstd 不可解）

## Goal

消除"响应重发时 content-encoding 头与实际 body 不符"的头体错配，以及 undici 无法解码 zstd 导致还原链读到乱码的两类缺陷；压缩响应的还原/分析在所有路径下正确工作。

## Background（09-21 实测复现，见本任务 research/repro.md）

- undici 自动解压 gzip/deflate/br，**但保留 content-encoding 头**；zstd 不解（原样字节）。
- 我方现状：仅 `streaming.ts:10` 删头；`route.ts` 非流式重建（`:143-149`）、SSE 无命中透传（`:115`）、二进制/无分析透传（`:125/127`）、bypass 非流式（`:287`）全部保留头 → 客户端二次解压失败（复现：`terminated` / `incorrect header check`）。
- 竞品依据：maskit `f1e8fc2`（恢复 accept-encoding 透传 + 还原前自行解压，并补"空映射也必须正确转发解压结果"的 socket 级测试）。
- 我方 e2e mock 上游零压缩用例（结构性盲区）。

## Requirements

- R1 转发侧：`accept-encoding` 过滤为网关可解码集合（gzip/x-gzip/deflate/br/identity，保留 q 参数）；zstd 与未知编码剔除；剔除后为空则显式 `identity`；客户端未带该头时不添加。
- R2 再发出侧统一归一：content-encoding 全部为已解码集合（gzip/x-gzip/deflate/br）→ 删除该头；zstd → 自行解压后删头；未知编码 → 保持原字节+原头并记日志（不尝试还原，避免产出乱码）。
- R3 zstd 防御性解压：流式路径经 `zlib.createZstdDecompress` 桥接；非流式读取路径经 `zlib.zstdDecompressSync`。
- R4 覆盖全部响应路径：SSE（有/无 restorer）、非流式（有/无 registry+analysis）、bypass、二进制透传。
- R5 回归测试（本地真实 HTTP 服务器 + undici 实链）：gzip/zstd 响应下流式文本完整、头被正确归一；helper 单测覆盖过滤/分类全分支。

## Acceptance Criteria

- [ ] AC1 `filterAcceptEncoding`：缺失→不变；`gzip, deflate, br, zstd`→去掉 zstd；`zstd`→`identity`；q 参数保留。
- [ ] AC2 本地 gzip 服务器：`createStreamingResponse` 输出明文、无 content-encoding 头（旧行为会头体错配）。
- [ ] AC3 本地 zstd 服务器：流式输出明文（zstd 解压生效）、无非协商编码残留；非流式读取路径同样得到明文。
- [ ] AC4 全量 `npm test` 绿 + `npm run build` 绿。

## Out of Scope

- 上游空闲超时 / mid-stream 容错（另有 backlog 记录）；对客户端的响应压缩（我们不主动编码，保持明文下发）。

## Open Questions

（无）
