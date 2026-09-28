# implement.md — 执行清单

前置：`python3 ./.trellis/scripts/task.py start 09-23-custom-term-legacy-tag-leak` 后开工；改动前先读 design.md 与注入的 spec。

## 步骤

1. **R1 通知语义化** — `src/proxy/disambiguation.ts:57-62`
   - `buildNotice` 改用「registry 首个签发标签」为样例；替换正则复用 `TAG_RE.source | EXPLICIT_TAG_RE.source`（import 自 `@/scanner/mask-tag`）。
   - 保持 `applyDisambiguation` 的注入判定与落点（309-321）零改动。
2. **测试** — 在既有 `src/__tests__/disambiguation.test.ts` 追加用例（见 design.md「测试计划」）。
3. **本地链路自测（可选）** — test DB 起本地实例：掩码请求注入通知断言无 `<<PRIVACY_MASK:`、样例为真实 `{{...}}` 且可还原。
4. **质量门** — `npm test`、`npx tsc --noEmit`、`npm run build` 全绿。
5. **AC 自查** — 对照 prd.md AC1-AC3 留证；AC4 为交付后用户侧服务端复测，写入任务 notes 交接。

## 风险文件 / 回滚点

- `src/proxy/disambiguation.ts`：改动面仅样例字符串，注入落点/协议面不动（任何落点变化都是回归）。
- 无 DB/协议改动；回滚 = revert 提交。
- 不触碰：自定义词短码逻辑、mask-tag 文法、restore 协议（现象①已复核为非缺陷，不修）。

## 完成前检查

- [x] AC1-AC3 有对应测试或实测证据；
- [x] 既有全套测试全绿（含 restore / json-mask / pii / custom-words 回归）；
- [x] 无新增日志泄露敏感值（quality 清单）；
- [x] notes 记录 AC4 服务端复测步骤交接。

## 执行记录（2026-09-23）

- 改动：`src/proxy/disambiguation.ts`（buildNotice 样例语义化 + `NOTICE_SAMPLE_RE`）、`src/__tests__/disambiguation.test.ts`（追加 5 用例）。
- 门：`npm test` 583 passed / `npm run build` ok（仓库 CI 契约仅此两门，.trellis/spec/shared/ci.md）；`npx tsc --noEmit` 的 12 个错误为 HEAD 既有基线（6 个无关测试文件），本次 diff 未新增。
- 本地 E2E：test DB 起 dev 实例 + mock 上游，上游可见载荷无 `<<PRIVACY_MASK:`、通知样例=真实签发标签、回显经还原（证据见 research/probe-evidence.md「本地端到端复核」）。
- AC4 服务端复测：用户侧执行，步骤见 design.md；交接已写入 task.json notes。
