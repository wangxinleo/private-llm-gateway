# 性能调研:大请求扫描链路延迟瓶颈

> **⚠️ 已被吸收**:本任务与 `08-06-scanner-false-positive-context-filter`(扫描范式重构:高风险资产配置 + 上下文窗口扫描)合并。窗口扫描天然解决了本任务的性能问题(扫描量 ∝ 白名单命中数×窗口,而非 全文×全管道)。基准基建、CSV 证据、批量扫描调研并入误报任务。本任务保留作历史记录,不再单独推进。

## Goal

定位 `/v1/responses` 等大请求(200-300KB 级别)在代理侧 2.5-3.5s(极端 7-8s)纯代理延迟的**算法层面根因**,产出可复现的基准测量、逐环节耗时分解与算法优化方案。日志中的耗时在 `src/app/api/[[...path]]/route.ts:198` 处于**转发上游之前**采样,因此 3.5s 是代理自身开销(读 body + 扫描 + 审计),与上游延迟无关。**用户明确:bypass 的扫描是有意为之(统计放行了多少秘密),本任务聚焦纯算法优化空间,不砍功能。**

## 决策记录(用户确认)

- D1: 任务边界 = 调研 + 基准 + 报告为主,附带最小原型验证(选项 A);不直接改生产代码路径。
- D2: **bypass 扫描是产品需求,不是可消除的开销**——用户需要知道放行了多少秘密(审计 findings 价值)。优化方向是**把扫描本身做快**,而非跳过扫描;findings 输出必须完整保留。bypass 分支可省的是"结果用不到"的部分(脱敏 body 重建、JSON 往返),findings-only 扫描路径是候选优化。
- D3: 目标 = 尽可能提高整体算法性能(非 bypass 与 bypass 同样受益);优化不得改变检测语义(误报/漏报不漂移)、不得阻碍请求正常执行。
- D8: **核心问题 = 算法优化空间**。优化主线:① 消除"逐字符串值全量扫描"的 N× 重复(批量扫描,findings 按值映射回);② 正则前缀/长度预过滤;③ bypass findings-only 路径;④ applyMasks / context-key 嵌套解码小项。
- D4: 基准负载 = **合成代理型负载**:程序化生成 278KB 级类 `/v1/responses` JSON(messages 数组含多段长文本[代码/日志/JSON 片段]+ 少量高价值字段[connection string、JWT、email]),参数化规模(128KB/278KB/512KB/1MB),确定性可复现,不含真实敏感数据。
- D5: 基准形态 = **仅报告不断言**:输出每环节耗时分解 + 总耗时,不设硬性阈值;CI/回归阶段再决定是否加阈值。
- D6: 原型范围 = **仅逐值扫描原型**:对 maskJsonBody 逐值全量扫描做批量扫描优化(先对全文本一次扫描→仅局部脱敏),验证收益;**不动 route.ts bypass 逻辑**。
- D7: 产出物归宿 = **全部保留**:报告写入任务目录 research/,原型保留在 src/scanner/ 独立文件(如 json-mask-batch.ts),基准脚本保留在 benchmarks/ + npm run bench 脚本,供后续实施任务复用。

## Confirmed Facts(已从代码确认)

- **嫌疑 1 — bypass 分支做了"结果用不到"的工作**:日志显示 `放行(跳过拦截)`(bypass 命中),`route.ts:122-158` 在 bypass 分支执行 `maskJsonBody`/`runPipeline` 全量扫描以产出审计 findings(产品需求,D2),但扫描结果(脱敏 body)被丢弃,原始 bodyText 原样转发。→ 可优化的是 findings-only 路径(省去脱敏 body 重建与 JSON 往返),不是跳过扫描本身。
- **致命嫌疑 2 — maskJsonBody 逐字符串值全量扫描(算法热点)**:`maskJsonBody`(json-mask.ts:137)解析 JSON 后递归 `scanValue`,对**每个字符串值**调用 `scanStringContext` → 构造 context 文本 → 调用 `runPipeline`(30+ secrets 正则 + 7 组 context-key 模式 + 4 组 PII 正则 + 排除规则)。278KB body 含数百个字符串字段时,等于每个字段各自跑一遍完整管道,复杂度近似 O(字段数 × 单字段全管道成本)。
- 扫描管道本身(`pipeline.ts`)对同一文本最多跑 3 类扫描(secrets / context-key / PII),`scanTextChunked` 中每 chunk 还会 `allFindings.some()` 线性重扫已发现项。
- `scanContextKey`(context-key.ts:397)对 `encoded` 组值会 `decodeBase64Value` → `decodedTextLooksSensitive` → **递归再跑 `extractCandidates`**(嵌套扫描,解码文本越大越贵)。
- `applyMasks`(pii.ts:61)对每个 finding 做 `replaceAll` + 重新 `new RegExp` 计数,findings 多时成本叠加。
- `initializeConfigs` 有 `configsInitialized` 旗帜,首次后为 O(1),非热点。
- `insertAudit` 每次 `db.prepare()`(better-sqlite3 有语句缓存)+ `broadcastAudit` SSE 广播,单次成本低,但每个请求都发生。
- 日志中 28× CONNECTION_STRING / 2× CONTEXTUAL_SECRET / 13× EMAIL 等命中表明扫描确实在高强度工作。

## Requirements

- R1: 建立可复现的大 payload 性能基准(脚本或测试),覆盖 128KB-1MB 区间,输出每环节耗时分解。
- R2: 用基准 + 代码路径分析**逐项量化**各算法嫌疑点的真实贡献(逐值扫描 N× 重复、正则回溯、findings-only 路径、applyMasks 计数、嵌套解码),而非猜测。
- R3: 产出调研报告:根因定位(带证据与 file:line 锚点)、各优化候选的预期收益与风险排序、检测语义等价性论证。
- R4: 若收益明确且改动可控,可附带最小原型验证(不要求上线);原型必须是**检测语义等价**的替代实现。

## Acceptance Criteria

- [ ] AC1: 基准脚本可一键运行,对 278KB 级 JSON 复现出秒级代理耗时,并输出 secrets/context-key/PII/审计各段耗时占比。
- [ ] AC2: 量化"逐字符串值全量扫描"的 N× 重复贡献(对比批量扫描原型的耗时差)。
- [ ] AC3: 量化"正则回溯 / 前缀预过滤"与"findings-only 路径"的贡献(若基准可测)。
- [ ] AC4: 调研报告含根因结论、证据锚点、≥3 个算法优化候选及其预期收益/风险排序,并论证检测语义等价性。
- [ ] AC5: 报告明确给出"下一步是否值得实施修复"的建议与最小修复范围。

## Out of Scope

- 不实施大规模重构;仅调研 + 可选最小原型。
- 不优化上游/网络延迟(耗时采样在转发前,与上游无关)。
- 不改变扫描规则本身的检测语义(避免误报/漏报漂移)。

## Open Questions

- (无阻塞项)目标时延是实施阶段才需决策;调研阶段仅需产出"是否值得修复"建议,不设硬性目标时延。