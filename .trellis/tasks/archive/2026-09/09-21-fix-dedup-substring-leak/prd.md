# 修复：脱敏去重的子串吸收导致独立出现明文泄漏（F1）

## Goal

消除"同一 leaf 内同值独立出现被按值子串吸收去重丢弃 → 该出现明文上行、审计却显示已脱敏"的静默泄漏；保持精确同值去重与既有 masking 语义（同位置嵌套由最长优先吸收）。

## Background（2026-09-21 桌面验证 F1，真实生产构建 + 真实链路复现）

- 根因定位：`src/scanner/context-window.ts:23-35` `push()` 的去重是**按值、位置盲**：
  - `longerMatchPresent()`：若某命中值是"另一处更长命中值"的子串 → 整条 finding 被丢弃；
  - 反向循环：新增长值时会删除已加入的短值 finding。
  - 结果：短值在**其它位置的独立出现**不再有 finding → `applyMasks` 不会替换它。
- 真实链路两例（网关 :3210 → mock 上游，echo 回显解码所得）：
  1. 最小复现（T5 触发）：`节点 fe80::1 与带zone fe80::1%eth0` → 转发体 `节点 fe80::1 与带zone {{IPV6PRIV_mqrbg}}`；审计只记 3 条 finding（应有 4 处出现）。
  2. **既有规则同样中招**（证明与本批 T5 无关）：`卡号 1380013800000003 与手机 13800138000` → 卡号脱敏、**手机号明文上行**；审计仅记 `BANK_CARD`。根因：`1380013800000003`.includes(`13800138000`) → PHONE finding 被吸收。
- 影响：脱敏路径上的静默明文外发（隐私网关最高危缺陷类）；任何"短值恰为长值子串"的组合都可能触发（PHONE/BANK_CARD、自定义词/子串词、IPv6±zone、连接串内含密钥值等）。
- 对照实现：`secrets.ts` 的重叠剪枝是**位置感知**的（`IndexedFinding{start,end}` + 同类别区间重叠判定，`pruneOverlappingSameCategoryFindings`）；唯独 `context-window.ts` 的跨来源合并退化为按值比较。

## Requirements

- R1 `scanContextWindows.push()` 移除子串吸收（`longerMatchPresent` 与反向删除循环），仅保留**精确同值去重**（`seen`）。
- R2 masking 输出语义保持不变：同位置嵌套仍由 `applyMasks` 的合并交替最长优先吸收（不双替换）；独立出现逐处替换。
- R3 同根次要缺陷一并收口：`applyMasksSequential`（>512 值的顺序替换回退路径）按 `matched` 长度降序处理，防短值先替换打碎长值字面量导致长值漏脱。`applyMasksCombined` 已按长度排序，无需改。
- R4 回归测试（新增 `src/__tests__/dedup-substring-leak.test.ts`）：
  - 正例 1（IPv6）：`fe80::1` 独立出现 + `fe80::1%eth0` → 两者都脱敏；
  - 正例 2（既有规则）：Luhn 有效卡号含手机号 + 独立手机号 → 两者都脱敏，审计 findings 含 `PHONE`；
  - 保持性 1：同一值被全量 pass 与窗口 pass 重复命中 → findings 不重复（精确去重仍在）；
  - 保持性 2：同位置嵌套（仅长值出现）→ 输出单个长值占位符、短值类别不产生额外替换；
  - 顺序路径：构造 >512 去重值场景下"短值在前"的输入，断言长值仍被完整替换（R3 守护）。
- R5 全量 `npm test` + `npm run build` 绿；spec 记录"去重不得按值吸收"的坑。

## Acceptance Criteria

- [ ] AC1 两个真实复现用例在扫描层（`scanContextWindows`）与端到端（`maskJsonBody`/管线）都产生对应 findings 且转发体无明文。
- [ ] AC2 精确同值去重不回归：重复来源（全量+窗口）不产生重复 finding。
- [ ] AC3 同位置嵌套语义不变：输出为长值占位符，无双替换/残余明文。
- [ ] AC4 顺序替换路径（>512 值）长值不被短值打碎（新守护用例）。
- [ ] AC5 全量测试与 build 绿；如条件允许，桌面复验两例（与 F1 验证同方法）。

## Out of Scope

- 方案 B（Finding 携带 span、端到端位置感知去重）——评估为收益不足，记录于 design.md §方案对比，留作后续可选；
- 其他扫描语义（窗口半径、类别开关、占位符格式）不动。

## 来源

- 父批次：`archive/2026-09/09-21-competitor-borrows`（桌面验证 F1 发现）。
- 复现证据：本任务 `research/repro-evidence.md`。
