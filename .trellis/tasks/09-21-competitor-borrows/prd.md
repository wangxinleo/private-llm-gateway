# 竞品借鉴批次：maskit/Cosy 09-21 差异落项

## Goal

把 2026-09-15~21 两个竞品仓库（maskit / CosyRedactGateway）调研出的 7 项差异，逐个立项、实现或评估、验收后归档。父任务自身不写生产代码，只做任务地图、跨子验收标准与最终集成复核。

## Task Map

| # | 子任务 | 类型 | 优先级 | 依赖 |
|---|---|---|---|---|
| T1 | `09-21-fix-thinking-state-skip` | 修复（缺陷，已实测） | P0 | 无 |
| T2 | `09-21-fix-compressed-response` | 修复（缺陷，已实测） | P0 | 无 |
| T5 | `09-21-ipv6-private-rule` | 实现（能力补全，默认关） | P1 | 无 |
| T7 | `09-21-env-config-warnings` | 实现（配置可见化） | P1 | 无 |
| T3 | `09-21-eval-local-ner` | 评估（go/no-go） | P2 | 无 |
| T4 | `09-21-eval-high-entropy` | 评估（go/no-go） | P2 | 无 |
| T6 | `09-21-eval-injection-signals` | 评估（go/no-go） | P2 | 无 |

## 跨子验收标准

- [ ] AC1 每个子任务：`npm run build` 绿 + `npm test` 全绿（评估类任务免除，改为文档完备性）。
- [ ] AC2 修复类子任务（T1/T2）必须带"先复现后修复"的回归测试；探针证据写入任务 research。
- [ ] AC3 实现类子任务（T5/T7）不改动既有默认行为（T5 新规则默认关；T7 仅告警不改变解析结果）。
- [ ] AC4 评估类子任务（T3/T4/T6）产出 `research/*.md`：选项对比、成本/收益、风险、go/no-go 结论与实施草图。
- [ ] AC5 每个子任务归档前：代码/文档 + 验收证据 + 提交完成；无未提交残留。
- [ ] AC6 最终集成复核：全量测试绿、`git status` 干净、7 个子任务全部 `completed`。

## Notes

- 排序：T1 → T2（两个真实缺陷）→ T5 → T7（小改）→ T3/T4/T6（评估）。
- 竞品借鉴合规：maskit 为 AGPL-3.0 仅借鉴设计思路、严禁复制代码；CosyRedactGateway 已切 Apache-2.0，若未来复用其代码需保留 NOTICE 归属（本批次仅 T4 评估涉及，届时另行判断）。
- 用户在本批次全部完成后做统一验收。
