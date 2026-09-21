# Implement — thinking/reasoning 状态跳过

## 步骤

- [ ] 1. 写回归测试 `src/__tests__/upstream-state-skip.test.ts`（正例 1-5 / 反例 6-10，先跑：正例应为红）。
- [ ] 2. 实现：`json-mask.ts` `scanValue` 增 `root` 参数 + `isUpstreamModelState` 谓词，三处判定接入。
- [ ] 3. `npx vitest run src/__tests__/upstream-state-skip.test.ts` 全绿（正例转绿、反例保持）。
- [ ] 4. 全量 `npm test` + `npm run build` 绿。
- [ ] 5. 更新 spec：`.trellis/spec/backend/reverse-proxy.md` 增加 Gotcha（协议状态跳过契约）。
- [ ] 6. 提交 + 归档。

## 验证命令

```bash
npx vitest run src/__tests__/upstream-state-skip.test.ts
npm test
npm run build
```

## 回滚点

- 步骤 2 后任意一步失败：`git checkout -- src/scanner/json-mask.ts`（测试文件单独保留可佐证）。
