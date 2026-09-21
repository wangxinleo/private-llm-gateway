# Implement — F1 去重子串吸收修复

## 步骤

- [x] 1. 写回归测试 `src/__tests__/dedup-substring-leak.test.ts`（PRD R4 五组）。先跑：3 个正例为红（复现 F1），2 个保持性用例为绿。
- [x] 2. 修复 `src/scanner/context-window.ts`：删除 `longerMatchPresent` 与反向删除循环，保留 `seen` 精确去重（R1/R2）。
- [x] 3. 收口 `src/scanner/pii.ts` `applyMasksSequential`：替换前按 matched 长度降序（R3）。
- [x] 4. 全量 `npm test`：517 passed / 9 skipped，无既有断言依赖旧吸收行为（无需更新既有用例）。
- [x] 5. `npm run build` 绿。
- [x] 6. spec：`.trellis/spec/backend/reverse-proxy.md` Gotcha 增补"finding 层不得按值子串吸收"（R5）。
- [x] 7. 桌面复验（生产构建 + mock 上游）：例 1 两处 IPv6 均占位符；例 2 卡号+手机号均占位符且审计 `findings:["PHONE","BANK_CARD"]`；嵌套保持性用例仅长值占位符。
- [x] 8. 提交 + 归档（`e81e896` + `4f22495`）。
- [x] 补充（归档后）：**全批次完整桌面回归**（T1/T2/T5/T7 + F1 + 并发 + GUI，修复后构建、全新 DB、双实例）结果与边界说明见 `research/full-regression-report.md`（修复前仅做定点复验，已由该报告补齐）。

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
