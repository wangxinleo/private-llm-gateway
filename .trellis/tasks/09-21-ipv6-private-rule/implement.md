# Implement — IPV6_PRIVATE 规则

## 步骤

- [ ] 1. 测试先行 `src/__tests__/ipv6-private.test.ts`（正反例 + 默认关/开启）。
- [ ] 2. `types.ts` FindingCategory + `config.ts` 默认关 + `mask-tag.ts` 短码 `IPV6PRIV`。
- [ ] 3. `pii.ts`：PiiRule 增可选 `prefilter`；新增候选正则/解析器/校验/预过滤；规则表接入。
- [ ] 4. `words/page.tsx` RULE_TOGGLE_CATEGORIES 加入。
- [ ] 5. 全量 `npm test` + `npm run build`。
- [ ] 6. spec 记录（IPV6 校验纪律 + 预过滤大小写坑）→ 提交 → 归档。

## 验证命令

```bash
npx vitest run src/__tests__/ipv6-private.test.ts
npm test && npm run build
```

## 回滚点

- 纯新增（规则默认关）：回滚 = 还原 5 个文件的增量，不影响既有行为。
