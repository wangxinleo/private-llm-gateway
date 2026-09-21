# Implement — HIGH_ENTROPY 规则

## 步骤

- [x] 1. `scripts/gen-entropy-table.mjs`：语料 Gutenberg #1342（sha256 入库）→ `src/scanner/entropy-table.ts`（29×29 扁平表 + provenance）。
- [x] 2. `scripts/calibrate-entropy.mjs`：文学留出 + 自然词拼接 p99.9 → 锚点（含生成物完整性校验与压力报告）→ `src/scanner/entropy-anchors.ts` + `research/calibration.md`。
- [x] 3. `src/scanner/entropy.ts`：tokenize/score/多样性/哈希守卫/阈值插值/scanHighEntropy（表维度错误显式抛错）。
- [x] 4. 接入：types/config(默认关)/mask-tag(HIGHENT)/words-page/context-window。
- [x] 5. 测试：`high-entropy.test.ts` 8 用例全绿。
- [x] 6. 基准：`benchmarks/high-entropy-1mb.test.ts`（1MB 开启增量 4.64ms，关闭 0）。
- [x] 7. 全量 `npm test` 527 passed + `npm run build` 绿。
- [x] 8. 桌面 1.5MB 压测：开/关增量 +13~27ms；HIGHENT 占位符生效、零残留；**附带发现并修复 F-A1**（Expect 头 502，`forwarder-headers.test.ts` 守护）。
- [x] 9. spec gotcha ×2（Expect/逐跳头、HIGH_ENTROPY 校准口径）+ 提交 + 归档。

## 验证命令

```bash
node scripts/gen-entropy-table.mjs && node scripts/calibrate-entropy.mjs
npx vitest run src/__tests__/high-entropy.test.ts src/__tests__/benchmarks/high-entropy-1mb.test.ts
npm test && npm run build
```

## 回滚点

- 生成物/实现均为新增；接入 5 处一行改动，`git revert` 即回。
