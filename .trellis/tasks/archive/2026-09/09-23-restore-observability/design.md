# T3 设计：响应还原可观测性

## 1. 数据流

```
请求侧 mask（已有 registry）
   └─ finalizeUpstream
        ├─ 非流式: restoreText(raw, registry, stats)  →  输出文本
        │            └─ findResidualPlaceholders(输出) → count/samples
        │            └─ recordRestoreStats(auditId, {restored, degraded, unresolved, samples})
        └─ 流式:  createStreamingResponse(upstream, restorer, analyzer)
                     analyzer.observe(已还原帧)× N；流尾 analyzer.finish()
                     finish: insertSignals(信号) + findResidualPlaceholders(累积文本)
                             + recordRestoreStats(auditId, {restorer.getStats(), unresolved})
```

`recordRestoreStats`（logger.ts）= `updateRestoreStats`（store.ts，SQL UPDATE）+ `broadcastAuditUpdate`（sse.ts，`event: audit_update`）。

## 2. 检测器（`src/scanner/placeholder-scan.ts`）

```ts
const KNOWN_LABELS = new Set(Object.values(CATEGORY_SHORTCODES));   // PHONE/EMAIL/BASIC_AUTH…
const RESIDUAL_TAG_RX = /\{\{?\s?([A-Za-z][A-Za-z0-9_]*)_([bcdfghjkmnpqrstvwxz]{5})\s?\}\}?/gi;
export function findResidualPlaceholders(text: string): { count: number; samples: string[] }
```

- 宽度 ≥ 语法：1-2 重花括号、花括号内可选空白、标签大小写不敏感；后缀必须 5 个辅音字母（`CONSONANTS`）。
- 标签白名单（大小写归一后比对 `CATEGORY_SHORTCODES` 值）：`{{user_name}}` 类模板噪声不命中。
- notice 示例豁免：`NOTICE_EXAMPLE_TAGS`（`PRIVACY_NOTICE_TEXT` 中的示例占位符，如 `{{EMAIL_trwmq}}`）从本模块导出 `isNoticeExampleTag`，`response-analysis.ts` 复用（原私有常量迁移）。
- samples：按出现顺序去重，≤5，仅原样 token（≤40 字符），不含明文。

## 3. 修复面加宽（restore.ts，R4）

`LOOSE_RX` 由 `\{{0,2}LABEL_SUFFIX\}{0,2}` 扩展为容忍：花括号内可选空白 + 标签大小写不敏感（`i` 标志）。宽松回调：

```
core = match 去两端花括号 → trim → 最后一个下划线切分 → label.toUpperCase() + "_" + suffix
lookup `{{label_suffix}}`；命中 → 替换 + degraded++/restored++；未命中 → 原样保留（留给 R3 计数）
```

只在 registry 命中时替换 → 零泄漏；`restored` 在严格与宽松两遍各自命中时各计一次，两遍作用于互斥文本（严格先替换），无重叠双计。

## 4. 落库

`audit_log` 新增 4 列（迁移风格对齐 mask_*）：

| 列 | 语义 |
|---|---|
| `restore_count` | 已还原出现次数（严格+降级） |
| `restore_degraded` | 其中降级修复次数 |
| `restore_unresolved` | 还原后仍残留的占位符 token 数 |
| `restore_samples` | JSON 数组，≤5，仅 token |

全部可空：`NULL` = 本次未发生还原遍（零拷贝透传、二进制、legacy、T2 超限跳过）。

## 5. 实时面板

- 服务端：`updateRestoreStats` 后广播 `event: audit_update`，`data: {id, restoreCount, restoreDegraded, restoreUnresolved, restoreSamples}`（token 非明文，不需 reveal）。
- 客户端（`audit-table.tsx`）：新增 `handleAuditUpdateEvent`——按 `id` 在 `data.rows` 中就地合并四字段；未命中（已翻页/被筛掉）忽略。插入事件（`event: audit`）行为不变。
- 展开区新增「响应还原」块（count 全 0 或全部为 NULL 时不渲染）：`已还原 N · 降级修复 D · 未还原 U` + 未还原样本 mono badges。i18n：`audit.restoreLabel` / `audit.restoreRestored` / `audit.restoreDegraded` / `audit.restoreUnresolved` / `audit.restoreSamples`（zh/en）。

## 6. 边界与取舍

- 计数仅发生在「本次请求发生过 mask（registry 非空）」的响应上——与热路径零拷贝透传一致；空 registry/legacy 盲区不覆盖（见 PRD Out of Scope）。
- 流式未还原计数基于分析器累积文本（`TEXT_ANALYSIS_LIMIT` 2MB 截断）；截断边界可能切开一个 token，计数下界。
- 信号 `response_poison.placeholder_residual` 与审计列 `restore_unresolved` 是同一检测器的两个出口（信号=安全提醒，列=统计面板）；二者数值应一致（同一文本、同一检测器）。
- 不加宽 `TAG_RE`（严格语法）本身；严格遍仍优先，宽松遍只做降级修复。

## 7. 测试

- `placeholder-scan.test.ts`：形态矩阵 + 白名单 + notice 豁免 + samples 上限/去重/无明文。
- `restore.test.ts` 扩展：`restored/degraded` 计数、空格/小写标签修复、未发行 token 原样保留、无双计。
- `restore-observability.test.ts`（路由级）：非流式与 SSE 两路——DB 四列 + `audit_update` 广播 + 零拷贝路径四列为 NULL。
- `response-analysis.test.ts`：既有 residual 断言全绿（共享检测器后计数不回归）。
