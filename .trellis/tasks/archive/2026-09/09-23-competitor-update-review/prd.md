# 竞品更新复查：maskit/Cosy 增量差异（09-23）

## Goal

复查两个竞品仓库自上轮调研（2026-09-21）以来的更新，做 diff 级差异分析并对照我方代码/探针实测，把有效差异逐个立项（修复/实现），验收后归档。父任务自身不写生产代码，只做任务地图、跨子验收标准与最终集成复核。

## 调研结论（详见 `research/competitor-update-09-23.md`）

- **CosyRedactGateway：无更新**（HEAD 仍为 09-18 的 `0e2be2e`；无新提交/tag/release）。
- **maskit：v0.4.0 已发布**（12 提交，其中引擎相关 4 项）。共梳理出 4 个与我方相关的差异，全部立项。

## Task Map

| # | 子任务 | 类型 | 优先级 | 依赖 |
|---|---|---|---|---|
| T1 | `09-23-ct-normalize` | 修复（探针实测缺陷） | P0 | 无 |
| T2 | `09-23-response-size-guard` | 修复（对照缺陷） | P1 | 无 |
| T3 | `09-23-restore-observability` | 实现（能力补全） | P1 | 无 |
| T4 | `09-23-stream-error-trace` | 修复（诊断补全） | P2 | 无 |

不采纳项（附件文件内容脱敏、扩展协议/桥失联、体积对齐等）及依据已记入调研报告 §2.2。

## 跨子验收标准

- [x] AC1 每个子任务：`npm test` 全绿 + `npm run build` 绿。（逐任务数据见下方复核表）
- [x] AC2 修复类子任务（T1/T2/T4）必须带「先复现后修复」的回归测试；探针证据写入任务 research。（T1 两触发面探针实测；T2 临时探针 P1/P2 先红；T4 复现 3 红 1 绿；各自 `research/probe-evidence.md` 留档）
- [x] AC3 行为兼容：T1/T2/T4 不改变正常路径（小写 content-type、正常体积、正常流）的既有行为；T2 跳过面不得改动响应体字节。（T2 用例断言越限透传字节一致；T1 小写对照 + 既有测试全绿；T4 `route-upstream-error.test.ts` 原 3 例保持绿）
- [x] AC4 留痕纪律（T2/T3）：跳过/未还原必须可见；留痕只存元数据与占位符样本，不得新增正文/明文落库面。（`restore_skipped`=reason/bytes/limit；`restore_unresolved`=计数+占位符样本 ≤5，unresolved 四列 NULL 语义为「未跑还原」）
- [x] AC5 每个子任务归档前：代码/文档 + 验收证据 + 提交完成；无未提交残留。（4 子任务提交链与归档提交见下方复核表）
- [x] AC6 最终集成复核：全量测试绿、`git status` 干净、全部子任务 `completed`。（详见下方复核记录）

## 最终集成复核记录（2026-09-23）

复核对象：master 集成 HEAD，批次提交链 `1a929ae`（立项）→ T1 `2db3f80`/`e9b12bf` → T2 `41c5f11`/`37d47af`/`d23e518` → T3 `7b9d0a3`/`277649e` → T4 `16648b6`/`c475da8`。

| # | 子任务 | 实现提交 | 归档提交 | 子任务验收全量测试 | build |
|---|---|---|---|---|---|
| T1 | `09-23-ct-normalize` | `2db3f80` | `e9b12bf` | 548 passed \| 1 skipped | 绿 |
| T2 | `09-23-response-size-guard` | `41c5f11`（+`37d47af` 清单补齐） | `d23e518` | 553 绿 | 绿 |
| T3 | `09-23-restore-observability` | `7b9d0a3` | `277649e` | 565 passed \| 1 skipped | 绿 |
| T4 | `09-23-stream-error-trace` | `16648b6` | `c475da8` | 572 passed \| 1 skipped | 绿 |

- 整合后终态复核：`npm test` 60 文件 / 572 passed | 1 skipped（exit 0）；`npm run build` exit 0；`git status` 干净。
- 4 子任务 `task.json` 均 `status: completed` 并归档至 `.trellis/tasks/archive/2026-09/`，各含 `research/probe-evidence.md`。
- 计划外发现：T4 修复过程中暴露 T4-AP1 潜在缺陷——`return finalizeUpstream(...)` 在 try/catch 中不捕获被返回 promise 的 rejection，缓冲路径读体失败会以未捕获异常逃逸（非 502、零审计痕迹）；已改 `return await` 并以探针钉死，详见 T4 探针证据。
- 合规复核：maskit 仅借鉴设计思路（诊断字段设计、体积闸与跳过留痕纪律），实现全部自研（`error-trace.ts`、`readBodyCapped`、`placeholder-scan.ts` 均为本项目代码），无 AGPL 代码复制；CosyRedactGateway 本轮零更新、无新增借鉴。

## Notes

- 竞品借鉴合规：maskit 为 AGPL-3.0 **仅借鉴设计思路，严禁复制代码**；CosyRedactGateway 为 Apache-2.0（本轮无更新，无新增借鉴）。
- 排序：T1（P0 实测缺陷）→ T2 → T3 → T4。
- 用户在本批次完成后做统一验收（沿用 09-21 批次方式）。
