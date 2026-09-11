# 性能证据:audit-log-2026-08-06.csv 分析

来源:用户提供的线上 audit 导出 CSV(2026-08-06 00:24-00:29, model=cc-auto, /v1/chat/completions)

## 关键观察

### 1. 扫描成本由 payload 大小决定,与命中数无关

| 请求 | 大小 | Action | Findings | 耗时(ms) |
|---|---|---|---|---|
| POST | 5,228 | allow | (none) | 7.22 |
| POST | 251,620 | allow | (none) | 245.18 |
| POST | 274,782 | allow | (none) | 253.28 |
| POST | 298,027 | mask | COOKIE_HEADER;SET_COOKIE_HEADER | 267.96 |
| POST | ~400K | mask | 13× CS + 1× BASIC | 320-400 |
| POST | 461,574 | mask | 13× CS + 1× BASIC | 392.69 |

**结论**:251KB allow 请求无任何命中也要 245ms → 扫描成本主要是 payload 大小 × 逐字符串值全量扫描次数,不是命中数。这直接印证性能任务主战场(maskJsonBody 逐值扫描,json-mask.ts:66-116)。

### 2. mask 比 allow 多 ~20-30%(脱敏重建成本)

- 298KB mask(2 findings): 267ms vs 274KB allow(0 findings): 253ms → 脱敏+JSON 往返占 ~5-15%
- 400KB mask(14 findings): 320-400ms vs 250KB allow: 245ms → findings 增多时脱敏重建成本上升

### 3. 误报模式稳定(与误报任务关联)

>340KB 请求几乎都命中 13× CONTEXTUAL_SECRET + 1× BASIC_AUTH:
- 13× CONTEXTUAL_SECRET = prose URL(https://…/mcp、/trellis、/SKILL.md、GitHub 链接)+ commit sha(e305055b…、ft-36486…)
- 1× BASIC_AUTH = "BasicFlow" 短英文词
→ 关联任务:`08-06-scanner-false-positive-context-filter`(上下文感知泛内容过滤)

## 用途

- 性能任务:anchor 数据证明"扫描成本 ∝ payload 大小 × 逐值次数",支撑批量扫描原型设计
- 误报任务:误报样本集(AC1 验收数据源)