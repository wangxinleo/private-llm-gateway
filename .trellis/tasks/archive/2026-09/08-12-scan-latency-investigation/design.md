# 设计:修复扫描管线 O(n²) 性能瓶颈

## 背景

排查任务(`08-12-scan-latency-investigation`)已用**真实抓包请求**(`真实请求.md`,1.18MB,Codex `/v1/responses`)复现并定位根因。本设计为后续实施任务提供方案。

## 根因(真实数据验证)

### 瓶颈分布(1.18MB 真实请求拆解)

| 阶段 | 耗时 | 占比 |
|---|---|---|
| `scanContextKey`(BRACKET 正则) | **2490 ms** | ~58% |
| `scanPii`(全文 PHONE/ID_CARD/BANK_CARD) | **1062 ms** | ~25% |
| `scanSecrets` | 16 ms | <1% |
| `maskJsonBody` 全流程(含对象级重复扫描放大) | **4272 ms** | 100% |

### 灾难回溯证据

`scanContextKey` 的 7 个 KEY_PATTERNS 正则中,**BRACKET 模式独占 2416ms / 2490ms**:

```regex
/([A-Za-z0-9_.-]+)\s*\[\s*["']?([^"'\]]+)["']?\s*\]/g
```

**灾难回溯机制**:
- 组 1 `[A-Za-z0-9_.-]+` 贪婪匹配长串(base64、token、hash)
- 随后 `\s*\[` 要求 `[`,无 `[` 时**回溯组 1 的所有子长度** → O(n²)
- 真实请求里大量 base64 token(`IZleyhnGqkHYW5pr3vV6Tyvw==`)、随机串、markdown `[**x**]`、ANSI `\u001b[0;34m`,每个 `[A-Za-z0-9_.-]+` 起点都回溯到串尾

**逐段证据**:100KB 段单独跑 100-340ms,但合在一起 `lastIndex` 不重置 → 1.18MB 跑 2686ms。

### JSON 路径放大器

`maskJsonBody` 的 `scanObjectContext`(json-mask.ts:71-93)对**每个 JSON 对象**拼成 contextText 再调 `scan`。真实请求 50 个 role × 嵌套 content 数组 → 上百个对象 → `scanContextKey`(含 BRACKET)被调用上百次 → 单次 2.5s 放大成 4.2s。

### 次要瓶颈

`scanPii` 全文跑 `/\d{16,19}/g`(BANK_CARD)+ `/\d{17}[\dXx]/g`(ID_CARD)+ `luhnCheck`,1.18MB 文本 1062ms。真实请求含大量数字串(时间戳、IP 段、哈希)触发 `luhnCheck`。

## 修复方案(优先级排序)

### 方案 1:修复 BRACKET 正则灾难回溯(最高优先级,预期降 60%)

**根因**:组 1 `[A-Za-z0-9_.-]+` 贪婪 + 后续 `[` 要求 → 回溯爆炸。

**修复选项**:

1a. **原子组 / 占有量词**:JS 不支持 `(?>...)`,但可用**负向预查**消除回溯。

1b. **收紧 key 字符集**:BRACKET 的组 1 原意是匹配"变量名/字典键",但 `[A-Za-z0-9_.-]` 太宽(base64 全命中)。改为 `[A-Za-z_][A-Za-z0-9_]*` 排除 base64 的连字符长串。

1c. **限制 key 长度**:`[A-Za-z0-9_.-]{1,64}` 截断超长回溯。

**推荐**:1b(收紧字符集)+ 1c(长度限制),语义安全且根治。

### 方案 2:消除 `maskJsonBody` 的对象级重复扫描(预期再降 1-2s)

**现状**:`scanObjectContext` 每个对象拼 contextText 全扫,`scanValue` 逐值也扫 → **同一内容扫两遍**。

**修复**:`maskJsonBody` 改为**收集所有字符串值 + 路径,拼一次全文扫描,再按区间回填掩码**。O(values) 拼接 + O(text) 单次扫描,消除 O(objects × text) 重复。

### 方案 3:`scanPii` 全文扫描优化(预期降 25%)

3a. **BANK_CARD 收紧**:`/\d{16,19}/g` 改为要求分隔符边界 `(?<!\d)\d{16,19}(?!\d)`,减少无意义候选。

3b. **PHONE 收紧**:`/1[3-9]\d{9}/g` 加 `(?<!\d)` 前瞻,避免长数字串内的子串误匹配。

3c. **ID_CARD 仅在窗口内扫描**(与 EMAIL 一致):身份证号不像手机号那么常见,可收窄到敏感锚点窗口内。

### 方案 4:`applyMasks` 区间合并替换(原方案 A,仍有效)

见前一版分析。真实请求 findings 少(1 条),此方案收益有限,但万级 findings 场景(工具调用输出含密钥)仍需。**保留为长期优化,不阻塞本次修复**。

## 实施优先级

| 优先级 | 方案 | 预期收益 | 风险 |
|---|---|---|---|
| P0 | 1b+1c BRACKET 字符集/长度 | -2.5s(60%) | 低:收紧 key 定义,回归测试覆盖 |
| P0 | 3a+3b scanPii 边界 | -800ms(20%) | 低:边界匹配,PII 测试覆盖 |
| P1 | 2 maskJsonBody 单次扫描 | -1-2s | 中:重构扫描入口,需全量回归 |
| P2 | 3c ID_CARD 收窄到窗口 | -100ms | 低:语义变更,需确认审计需求 |
| P3 | 4 applyMasks 区间化 | 万级 findings 场景 | 中:replacementCount 语义 |

## 验收标准(实施任务)

- [ ] `真实请求.md` 1.18MB 的 `maskJsonBody` 耗时从 4272ms → ≤500ms
- [ ] 全部 355 个现有测试通过
- [ ] `benchmarks/apply-masks-scaling.test.ts` 不回归
- [ ] 新增 BRACKET 灾难回溯回归用例(基于真实 payload 的 base64/ANSI/markdown 段)
- [ ] PII 边界匹配不误伤现有 PHONE/ID_CARD/BANK_CARD 用例

## 实施结果(2026-08-12,子任务 08-12-fix-scan-pipeline-perf)

**已实施 P0-1 + P0-2,目标达成 54x**:

| 项 | 修复前 | 修复后 |
|---|---|---|
| `scanContextKey`(真实 1.18MB) | 2526 ms | 32.4 ms |
| `scanPii`(真实 1.18MB) | 1062 ms | 5.9 ms |
| `maskJsonBody` 全流程 | 4272 ms | **79.2 ms** |

**关键修正**:scanPii 的 1062ms 大头顶在 **EMAIL 正则**(local part 贪婪回溯),数字类正则只占 2ms。修复后 PII 正则全部加 lookbehind 边界。

**P1(对象级重复扫描)决策:不做**。收益仅 40ms,需重构 `scanObjectContext` 兄弟值上下文语义,风险高。

**留下待办(后续任务)**:
- `applyMasks` 区间合并替换(P3,万级 findings 场景,`benchmarks/apply-masks-scaling.test.ts` 已锁定 40k findings→5.7s 的基线)
- ID_CARD 收窄到窗口内(P2)

## 复现资产

- `真实请求.md`(1.18MB 真实抓包,脱敏后,作为基准语料)
- `benchmarks/apply-masks-scaling.test.ts`(applyMasks O(findings×text) 曲线)
- 本文档的逐阶段/逐正则拆解表

## Implementation boundary (2026-08-14)

The P0 regex and PII boundary fixes were implemented by child task `08-12-fix-scan-pipeline-perf` and are recorded there as historical evidence. The planned P1 object-level scan consolidation was deliberately not implemented after the measured follow-up showed only about 40 ms of remaining benefit with substantial sibling-context compatibility risk. P2 ID-card scope changes and P3 interval-based masking remain unimplemented.

The latest architecture research recommends a separate span-based pipeline: structured JSON scan units, compatible-window merging, source-relative findings, deterministic overlap resolution, and one final masking pass. That work belongs to `08-14-scanner-span-pipeline-architecture`; it must not be counted as part of the completed P0 fix.

The parent integration gate is therefore: reconcile historical evidence, link the child task and research records, validate the task manifests, and leave implementation of the new architecture to its own planning and review cycle.
