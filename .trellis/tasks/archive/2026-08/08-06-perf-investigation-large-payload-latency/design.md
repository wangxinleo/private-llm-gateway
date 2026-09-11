# 性能调研设计:大请求扫描链路延迟瓶颈

## 1. 架构与边界

```
线上请求(200-300KB JSON)
  → route.ts handleRequest
      ├─ extractBodyText          (读 body,~O(body))
      ├─ findMatchingBypassRule   (bypass 判断)
      ├─ bypass 分支: 仍跑全量扫描仅供审计  ← 产品需求(统计放行的秘密),不砍
      │     └─ 但 maskedBody 结果被丢弃 → findings-only 路径可省脱敏/JSON 往返
      ├─ 正常分支: maskJsonBody / runPipeline
      │     └─ maskJsonBody: JSON.parse → scanValue 递归
      │           └─ 每个字符串值 → scanStringContext → runPipeline 全管道  ← 主战场(N×重复)
      ├─ logAudit (insertAudit + broadcastAudit)
      └─ forwardRequest (转发上游,耗时采样点之前)
```

调研边界:只读分析 + 隔离基准 + 隔离原型。不修改 `route.ts`、`pipeline.ts`、`secrets.ts`、`context-key.ts`、`pii.ts` 等生产文件。

## 2. 数据流与契约

### 2.1 基准脚本(新增,不触碰生产)

- 位置:`benchmarks/scan-bench.ts`(或 `benchmarks/scan-bench.test.ts` 用 vitest 跑)
- 运行方式:`npm run bench`(新增 script,走 vitest 或独立 tsx)
- 负载生成:`benchmarks/fixtures/proxy-payload.ts` 程序化生成类 `/v1/responses` JSON
  - messages 数组:多段长文本(content 字段,代码/日志/JSON 片段)
  - 高价值字段:connection string、JWT、email 各若干,混入 content 与独立字段
  - 参数化规模:128KB / 278KB / 512KB / 1MB
- 输出:每环节耗时分解(secrets / context-key / PII / JSON 解析 / 脱敏 / 审计),总耗时
- 断言:仅报告,不设阈值(D5)

### 2.2 原型(新增,不触碰生产)

- 位置:`src/scanner/json-mask-batch.ts`
- 目的:验证"批量扫描"替代"逐字符串值全量扫描"的收益
  - 核心观察:代码已有 `scanObjectContext`(json-mask.ts:71)对对象所有字符串子值拼成一段文本**只扫一次**,但随后 `scanValue` 对每个子值**又各自扫一遍** `scanStringContext` → 一个对象实际 1 + N 次扫描,逐值那 N 次是冗余大头
  - 原型策略:对每个对象(或全 JSON)只扫一次,批量 findings 按值映射回各字段,只对命中字段做局部脱敏
- 契约:导出与 `maskJsonBody` 同签名函数(如 `maskJsonBodyBatch`),findings/maskedBody 与 `maskJsonBody` **语义等价**(同一负载产出相同 findings 与脱敏结果),便于基准对比
- 不修改 `route.ts`:原型仅被基准脚本调用,生产请求仍走原 `maskJsonBody`

### 2.3 耗时分解插桩

- 基准脚本内对 `scanSecrets` / `scanContextKey` / `scanPii` 做原位计时(不改生产文件,在基准脚本里用 `performance.now()` 包裹调用)
- 若需对 `runPipeline` 内部计时且不想改生产文件:在基准脚本中直接调用底层函数并分别计时(secrets/context-key/pii 的调用点都在 pipeline.ts,但基准脚本可重新组合调用顺序)

## 3. 关键测量指标

| 指标 | 来源 |
|---|---|
| 总代理耗时(转发前) | 基准脚本总计时 |
| 扫描耗时占比 | secrets/context-key/PII 分项计时 |
| JSON 解析耗时 | `JSON.parse` 计时 |
| 脱敏耗时 | `applyMasks` 计时 |
| 审计耗时 | `insertAudit` + `broadcastAudit` 计时 |
| 逐值扫描触发次数 | 基准脚本内统计 `scanStringContext` 调用次数(通过原型插桩) |

## 4. 兼容性与风险

- 基准脚本与原型均为新增文件,不改变任何现有导出/行为 → 零兼容风险
- `npm run bench` 新增 script,不影响 `npm test` / `npm run build`
- 若基准脚本 import 生产模块(如 `runPipeline`)并触发 `configsInitialized`,需在基准脚本内先 `initializeConfigs()`(已有 ID 守卫,幂等)
- 基准脚本若写 audit 数据库,需在测试环境用临时 DB_PATH(env 注入),避免污染线上 audit.sqlite

## 5. 回滚与运维

- 无生产改动 → 无回滚需求
- 原型文件若后续实施任务采用,只需把 `json-mask-batch.ts` 的导出函数替换 route.ts 调用点即可,可独立回滚

## 6. 关键风险与缓解

| 风险 | 缓解 |
|---|---|
| 基准不能真实复现线上 3.5s(负载/机器差异) | 合成负载贴近线上形态;报告给出观察值而非绝对结论;标注运行环境 |
| 逐字符串扫描计数不准(原型插桩影响性能) | 计数用轻量计数器,不参与计时;计时与计数分离跑 |
| 扫描耗时分解受 JIT 预热影响 | 基准脚本先跑 warmup 轮,再取稳定轮次数据 |
| 审计写库干扰基准 | 基准脚本用临时 DB_PATH + 关闭 SSE 广播(若可配置) |
| 批量扫描导致检测语义漂移(漏检/误检) | 原型必须与 `maskJsonBody` 做 findings 等价断言,不止比速度 |