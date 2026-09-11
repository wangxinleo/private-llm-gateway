# 修复扫描管线性能瓶颈(灾难回溯+重复扫描)

## 背景

父任务 `08-12-scan-latency-investigation` 已用真实抓包(1.18MB Codex `/v1/responses`)定位根因:

1. **BRACKET 正则灾难回溯**(`src/scanner/context-key.ts:200`):`/([A-Za-z0-9_.-]+)\s*\[\s*["']?([^"'\]]+)["']?\s*\]/g` 组 1 贪婪匹配长串后回溯 → O(n²)。真实请求工具输出含大量 base64/ANSI/markdown,单此正则占 `scanContextKey` 2490ms / 2526ms。
2. **scanPii 全文扫描**(`src/scanner/pii.ts`):`/\d{16,19}/g` 银行卡 + `luhnCheck` 在数字串丰富的真实内容上产生大量候选,1062ms。
3. **maskJsonBody 对象级重复扫描**(`src/scanner/json-mask.ts:71-93` `scanObjectContext`):每个 JSON 对象拼 contextText 全扫 + `scanValue` 逐值全扫 → 同一内容扫两遍,把单次 2.5s 放大成 `maskJsonBody` 全流程 4272ms。

线上 1.25MB 请求 18.5s 由此而来(真实抓包 1.18MB 复现 4.3s,线上更大)。

## 目标指标

- 真实请求 `真实请求.md` 的 `maskJsonBody` 全流程耗时:**4272ms → ≤500ms**(降 8.5x)
- 其中:`scanContextKey` ≤200ms(现 2526ms)、`scanPii` ≤200ms(现 1062ms)

## 实施范围

### P0-1:修复 BRACKET 正则灾难回溯(预期 -2.5s)

`src/scanner/context-key.ts` KEY_PATTERNS 的 BRACKET 项:

```regex
当前:/([A-Za-z0-9_.-]+)\s*\[\s*["']?([^"'\]]+)["']?\s*\]/g
```

修复方式(design.md 推荐 1b+1c):
- 收紧组 1 字符集:排除 base64 的连字符/点组成的超长串,改为更贴近"变量名/字典键"的形态
- 限制组 1 长度上限(如 `{1,64}`),截断超长回溯
- **必须保持匹配语义**:`arr[0]`、`obj["key"]`、`data[i]` 这类真实字典/数组访问仍要命中

### P0-2:scanPii 全文扫描加边界(预期 -800ms)

`src/scanner/pii.ts`:
- `BANK_CARD_RE = /\d{16,19}/g` → 加 `(?<!\d)` / `(?!\d)` 边界,避免长数字串内子串误匹配
- `PHONE_RE = /1[3-9]\d{9}/g` → 加 `(?<!\d)` 边界
- `ID_CARD_RE = /\d{17}[\dXx]/g` → 加 `(?<!\d)` 边界

### P1:maskJsonBody 消除对象级重复扫描(预期再 -1-2s)

`src/scanner/json-mask.ts`:
- 现状 `scanObjectContext` 每个对象拼 contextText 全扫 + `scanValue` 逐值全扫
- 改为:收集全部字符串值及其路径,一次拼接扫描,按 finding 的 `matched` 值回填到对应字符串值
- **保持语义**:PII 全局扫描(电话/身份证/银行卡)不依赖窗口;EMAIL/secret 仍按锚点窗口;block 行为不变

### 验收标准

- [ ] `benchmarks/scan-latency-real.test.ts` 真实请求 `maskJsonBody` ≤500ms(现 4272ms)
- [x] `benchmarks/apply-masks-scaling.test.ts` 不回归(当前基准通过,但 40,000 findings 基线仍约 5591.4ms)
- [x] 全部现有测试通过(`npm test`:30 个文件通过、1 个跳过;358 个测试通过、1 个跳过)
- [ ] 新增回归用例:
  - BRACKET 灾难回溯:base64 长串 + ANSI 码 + markdown `[**x**]` 混合文本,`scanContextKey` ≤200ms
  - PII 边界:长数字串内嵌银行卡号不误报;独立的 16-19 位数字仍命中
  - JSON 路径:`arr[0]`、`obj["key"]`、`data[i]` 字典/数组访问仍被 `scanContextKey` 命中
- [ ] `maskJsonBody` 的 block 行为、maskSummary、replacementCount 语义不变(disambiguation 依赖)

## 不在范围

- P1(maskJsonBody 消除对象级重复扫描):**已决策不做**。历史会话记录为 54x(4272→79ms),P1 预期收益仅 40ms,但需重构 `scanObjectContext` 兄弟值上下文语义,风险高、现有测试依赖该语义;该历史结果不代表当前生产延迟已解决。
- `applyMasks` 区间合并替换(design.md 方案 4,P3,万级 findings 场景,后续任务)
- ID_CARD 收窄到窗口内(P2,语义变更需确认)
- 其他 KEY_PATTERNS 的正则(QUOTED_KV/BARE_KV 等,实测不慢)

## Historical status pointer

The detailed implementation record, fixed-pattern description, benchmark table, and historical regression-test result are maintained in `design.md` and `implement.md`. This PRD intentionally keeps only the requirements, acceptance criteria, scope exclusions, and evidence limitations needed to decide whether the child can be completed.

The historical session recorded 79.2 ms for the real 1.18 MB fixture and 359 passing tests. Those figures remain historical only and are separate from the current revalidation counts below. The sensitive `真实请求.md` fixture is absent, so `benchmarks/scan-latency-real.test.ts` may only be reported as skipped until the fixture is deliberately supplied.

## 备注

- 基准语料 `真实请求.md` 为敏感数据,不入库;实施时如缺失需用户重新提供或改用合成语料(工具输出形态)。
- 父任务 design.md 有完整拆解表和方案对比,实施前必读。

## Follow-up validation (2026-08-13)

The available `查因.md` payload does not reproduce the historical regression. A production-semantics benchmark measured a 223,889-byte JSON body at `0.197 ms` for parsing, `2.733 ms` for a flat `runPipeline`, and `18.955 ms` for the complete `maskJsonBody` flow, with zero findings and an `allow` action. The nested scan callback ran 1,394 times per `maskJsonBody` call, confirming that the remaining object-level fan-out is not currently material for this payload.

The route records pre-audit request duration before synchronous `logAudit`/SQLite insertion; it is not scanner-only time, and audit persistence is not part of the recorded duration. `initializeConfigs` is one-time per process, not globally across workers or restarts. No further production scanner change is justified without the missing production audit CSV, deployed build identity, and phase timings from the affected runtime. This is a local follow-up diagnosis, not proof that production latency is resolved.

## Artifact reconciliation (2026-08-14)

The P0 measurements and `359 passed` count above are recorded from the historical implementation session and commit history. The real `真实请求.md` fixture is absent from the repository, so the real-payload benchmark cannot currently establish the 4272 ms → 79.2 ms comparison. The available `查因.md` replay is a separate 223,889-byte, zero-finding sample and must not be substituted for the production regression.

This child owns only the completed P0 regex/PII boundary work. P1 duplicate JSON scanning was intentionally excluded, P2 ID-card scope narrowing remains a policy decision, and P3 span/`applyMasks` work remains future work. The new span-based architecture is tracked by child task `08-14-scanner-span-pipeline-architecture`.

## Current revalidation evidence (2026-08-17)

- Commit `6cd2bcc9aae00b3b9371abe99c88391d6e0effd5` was confirmed as the recorded P0 implementation.
- `npm test` passed with 30 files passed and 1 skipped; 358 tests passed and 1 skipped.
- `npx tsc --noEmit` passed.
- `npm run build` passed.
- `benchmarks/apply-masks-scaling.test.ts` passed, but its 40,000-finding baseline remained about 5591.4 ms. That finding-heavy P3 problem is not resolved by this P0 child.
- `benchmarks/scan-latency-real.test.ts` was skipped because `真实请求.md` is absent. The real-payload acceptance item remains unchecked, and the historical 79.2 ms result is not promoted to current evidence.
- The prior five-way review was inconclusive. It is not treated as a passing review or as proof of a production-latency resolution.

The task remains `in_progress` with `completedAt: null` until the separately authorized lifecycle command runs. This reconciliation does not archive the task, and production latency remains unproven.
