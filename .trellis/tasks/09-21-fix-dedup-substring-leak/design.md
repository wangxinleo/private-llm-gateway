# Design — F1 去重子串吸收修复

## 根因链（已实测，三段）

```
文本: "节点 fe80::1 与带zone fe80::1%eth0"
  ① findIpv6Private / scanPii → 4 个 finding 值:
     fe80::1, Fe80::1, fe80::1%eth0, fd00::5   (按文本顺序)
  ② push() 位置盲去重:
     "fe80::1%eth0".includes("fe80::1") → 与之无关的独立出现 finding 被丢弃
     → 最终只剩 3 条（audit 实测 findings: IPV6_PRIVATE ×3）
  ③ applyMasks 仅能替换 findings 中的值
     → 第一处 "fe80::1" 原样进入转发体（明文上行）
```

`context-window.ts:23-35` 原实现：

```ts
const longerMatchPresent = (candidate) => allFindings.some(f => f.matched.length > candidate.length && f.matched.includes(candidate));
// push(): if (longerMatchPresent(f.matched)) continue;   ← 丢弃短值
//         if (existing.matched.length < f.matched.length && f.matched.includes(existing.matched)) { 删除 existing }  ← 反向删除
```

## 为什么按值吸收在语义上错误

- 吸收的隐含假设是"短值的所有出现都被长值覆盖"。跨位置比较**值**无法支撑该假设：短值可能在别处**独立出现**。
- 同位置嵌套的真正处理点在 `applyMasks`：合并交替按字面量**长度降序**排列，扫描到该位置时长值先匹配并整体消费，短值不会二次替换——**masking 正确性不依赖 push() 的按值吸收**。
- `secrets.ts` 已在同一问题域使用位置感知剪枝（`pruneOverlappingSameCategoryFindings`：区间重叠才剪，且限于同类别），说明"位置感知"是本仓库既有正确范式；`context-window.ts` 的跨来源（全量 pass + 窗口 pass）合并是唯一的例外。

## 方案对比

| 方案 | 做法 | 成本 | 风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）** | 删除 `longerMatchPresent` 与反向删除循环，仅保留 `seen`（精确同值去重）；重叠交给 `applyMasks` 的最长优先交替 | 单文件 ~10 行；测试新增 | 审计 findings 计数在"嵌套值"场景会增加（如卡号内含手机号 → 同时记 BANK_CARD+PHONE）——更准确，但需复核既有断言 | **采纳** |
| B | Finding 携带 span，去重改为区间判定（端到端位置感知） | 改类型 + pii.ts/secrets.ts/custom-words.ts/pipeline 全链路 | 面大、回归风险高；收益（审计计数更"干净"）不足 | 记录为后续可选 |
| C | 保留吸收但加"独立出现检测"（用 leaf 文本 + indexOf 计数） | 中（需把 text 传入 push，逻辑绕） | 近似判断仍有边界漏 | 不采纳 |

## 变更点

1. `src/scanner/context-window.ts`：`push()` 删两处按值吸收，保留 `seen` 精确去重。
2. `src/scanner/pii.ts`：`applyMasksSequential` 在替换前按 `matched.length` 降序排序（与 `applyMasksCombined` 的长度优先语义对齐）。顺序路径仅 >512 去重值触发，属同根风险收口。
3. 不变式（写入 spec gotcha）：
   - 同值跨来源只记一条 finding；
   - 重叠/嵌套脱敏由 `applyMasks` 的位置级最长优先保证，**不得**在 finding 层做按值子串吸收；
   - 审计计数可以因嵌套值增加（信息更完整），不属于回归。

## 影响与兼容

- masking 输出：仅在 F1 泄漏场景发生变化（独立出现从漏脱变为脱敏）；正常单值/单出现场景字节级不变。
- 审计：嵌套值场景 findings 计数增加；`matchedValues` 结构不变（按类别聚合）。
- 性能：findings 数量上限受类别数与出现数约束；合并交替 ≤512 值仍走组合路径，超限走顺序路径（R3 排序无额外开销）。

## 回滚

- 纯函数级改动：`git revert` 单提交即回；无数据/协议迁移。
