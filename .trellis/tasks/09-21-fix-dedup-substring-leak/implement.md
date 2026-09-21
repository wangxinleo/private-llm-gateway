# Implement — F1 去重子串吸收修复

## 步骤

- [ ] 1. 写回归测试 `src/__tests__/dedup-substring-leak.test.ts`（PRD R4 五组：IPv6 正例 / PHONE+BANK_CARD 正例 / 精确去重保持 / 同位置嵌套保持 / 顺序路径守护）。先跑：正例应为红（复现 F1）。
- [ ] 2. 修复 `src/scanner/context-window.ts`：删除 `longerMatchPresent` 与反向删除循环，保留 `seen` 精确去重（R1/R2）。
- [ ] 3. 收口 `src/scanner/pii.ts` `applyMasksSequential`：替换前按 matched 长度降序（R3）。
- [ ] 4. 全量 `npm test`：复核是否有依赖旧吸收行为的断言；若有，按"审计计数增加属预期"原则更新并在提交信息中写明。
- [ ] 5. `npm run build` 绿。
- [ ] 6. spec：`.trellis/spec/backend/reverse-proxy.md` Gotcha 增补"finding 层不得按值子串吸收"（R5）。
- [ ] 7. 桌面复验（与 F1 同方法）：生产构建 + mock 上游，两例转发体无明文（AC5）。
- [ ] 8. 提交 + 归档。

## 验证命令

```bash
npx vitest run src/__tests__/dedup-substring-leak.test.ts
npm test && npm run build
```

## 桌面复验脚本要点（沿用本次验证环境）

- 网关：`node .next/standalone/server.js`（PORT=3210，真实 mock 上游 :8787 `/scenario/echo` 回显 base64）。
- 例 1：`节点 fe80::1 与带zone fe80::1%eth0`（需开启 IPV6_PRIVATE）→ 转发体两处均为占位符。
- 例 2：`卡号 1380013800000003 与手机 13800138000` → 转发体两处均为占位符；审计 findings 含 BANK_CARD 与 PHONE。

## 回滚点

- 步骤 2/3 后任一失败：`git checkout -- src/scanner/context-window.ts src/scanner/pii.ts`。
