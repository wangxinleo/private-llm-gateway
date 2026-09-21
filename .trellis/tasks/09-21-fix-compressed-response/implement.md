# Implement — 压缩响应链路

## 步骤

- [ ] 1. 写实链回归测试 `src/__tests__/content-encoding.test.ts`（本地 gzip/zstd 服务器；先跑应为红）。
- [ ] 2. 新增 `src/proxy/content-encoding.ts`（过滤/分类/删头/zstd 解压）。
- [ ] 3. 接入 `forwarder.ts`、`streaming.ts`、`route.ts`（finalizeUpstream + bypass）。
- [ ] 4. 单测 + 全量 `npm test` + `npm run build` 绿。
- [ ] 5. spec gotcha（reverse-proxy.md）；提交 + 归档。

## 验证命令

```bash
npx vitest run src/__tests__/content-encoding.test.ts
npm test && npm run build
```

## 回滚点

- 步骤 3 后失败：`git checkout -- src/proxy/forwarder.ts src/proxy/streaming.ts "src/app/[...path]/route.ts"`。
