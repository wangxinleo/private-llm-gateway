# 排查大请求扫描管线性能问题(14-18秒延迟)

## 背景

`audit-log-2026-08-12.csv` 显示 `/v1/responses` 请求(model: `gpt-5.6-luna`)的 Duration 随请求体大小线性增长,1.25MB 请求耗时 **18.5 秒**,417KB 请求 4.9 秒,斜率约 **15 ms/KB**。同模型小请求(6KB)仅 3.9ms。Duration 在 `route.ts:198` 于 `forwardRequest` 之前计算,所以延迟完全来自扫描+审计写入,不含上游 LLM 时间。

用户提供了真实抓包请求(`真实请求.md`,1.18MB,Codex `/v1/responses`),已用该语料复现并精确定位根因。

## 根因(已用真实抓包请求定位,证据链完整)

### 核心瓶颈:BRACKET 正则灾难回溯(O(n²))

`scanContextKey` 的 7 个 KEY_PATTERNS 中,**BRACKET 模式独占 2490ms / 2526ms**:

```regex
/([A-Za-z0-9_.-]+)\s*\[\s*["']?([^"'\]]+)["']?\s*\]/g
```

组 1 `[A-Za-z0-9_.-]+` 贪婪匹配长串(base64、token、hash),随后 `\s*\[` 要求 `[`,无 `[` 时**回溯组 1 所有子长度** → O(n²)。真实请求里大量 base64 token(`IZleyhnGqkHYW5pr3vV6Tyvw==`)、随机串、markdown `[**x**]`、ANSI `\u001b[0;34m` 触发回溯。逐段证据:100KB 单独跑 100-340ms,合在一起 1.18MB 跑 2686ms(超线性)。

### 真实请求拆解(1.18MB)

| 阶段 | 耗时 | 占比 |
|---|---|---|
| `scanContextKey`(BRACKET 正则) | **2490 ms** | ~58% |
| `scanPii`(全文 PHONE/ID_CARD/BANK_CARD) | **1062 ms** | ~25% |
| `scanSecrets` | 16 ms | <1% |
| `maskJsonBody` 全流程 | **4272 ms** | 100% |

### 放大器:`maskJsonBody` 对象级重复扫描

`scanObjectContext`(json-mask.ts:71-93)对**每个 JSON 对象**拼 contextText 再调 `scan`,`scanValue` 逐值也扫 → 同一内容扫两遍。真实请求 50 role × 嵌套 content → 上百次 `scanContextKey` 调用 → 单次 2.5s 放大成 4.2s。

### 触发条件

用户观察"工具调得越多、读写文件多就越慢"与根因一致:工具调用输出(`function_call_output`)含文件内容/代码/日志/终端输出 → 大量 base64、token、ANSI 码、markdown → BRACKET 回溯 + PII 候选爆炸。

### 先前假设(applyMasks O(findings×text))

合成语料验证时发现 `applyMasks` 在万级 findings 下线性爆炸(40k findings → 5.7s),但真实请求 findings 仅 1 条,此路径非当前主因。保留为长期优化(见 design.md 方案 4)。

## 需求

1. **用真实请求复现** ✅ 用户提供 `真实请求.md`(1.18MB 抓包),`maskJsonBody` 实测 4272ms
2. **定位瓶颈** ✅ BRACKET 正则灾难回溯(2490ms)+ scanPii(1062ms)+ JSON 对象级重复扫描放大(→4272ms)
3. **产出优化方案**(实施放后续任务):见 design.md

## 优化方向(供后续任务设计,详见 design.md)

| 优先级 | 方案 | 预期收益 | 风险 |
|---|---|---|---|
| P0 | 修复 BRACKET 正则(收紧字符集+限长) | -2.5s(60%) | 低 |
| P0 | scanPii 加边界(手机号/银行卡 `(?<!\d)`) | -800ms(20%) | 低 |
| P1 | maskJsonBody 单次全文扫描替代对象级重复扫描 | -1-2s | 中 |
| P2 | ID_CARD 收窄到窗口内 | -100ms | 低 |
| P3 | applyMasks 区间合并替换(万级 findings 场景) | 长期 | 中 |

## 验收标准

- [x] 复现 ≥10 秒延迟的基准场景(真实请求 `真实请求.md`:maskJsonBody 4272ms;线上 1.25MB 18.5s)
- [x] 定位瓶颈:BRACKET 正则灾难回溯 + scanPii 全文 + JSON 对象级重复扫描
- [x] 基准脚本留在 benchmarks/(apply-masks-scaling.test.ts)
- [x] 产出 ≥3 个优化方案及预期收益/风险(design.md)

## 范围

- **本任务**:定位根因(已完成)+ 产出方案(已完成)
- **后续任务**:实施优化(需独立 PRD,验收标准见 design.md)

## 备注

- 真实请求体由用户提供(`真实请求.md`,1.18MB 抓包,内含 base64/token/ANSI/markdown 等触发灾难回溯的内容)。
- 先前 applyMasks O(findings×text) 假设在合成语料下成立(40k findings → 5.7s),但真实请求 findings 少,非当前主因。

## Artifact reconciliation (2026-08-14)

This task remains the investigation umbrella. The historical P0 implementation is owned by child task `08-12-fix-scan-pipeline-perf`; the span-based masking and structured-unit architecture is intentionally separated into child task `08-14-scanner-span-pipeline-architecture` and is not represented as completed work here.

The follow-up replay in `08-12-fix-scan-pipeline-perf/research/2026-08-13-cha-yin-payload-follow-up.md` measured a 223,889-byte payload at 18.955 ms with zero findings. It also established that the route's recorded duration is measured before synchronous audit persistence. This does not prove that the historical production latency is resolved because the production body, deployed build identity, and deployed phase timings are unavailable.

The 79.2 ms result and 359 passing tests recorded by the implementation child are historical task evidence, not measurements newly rerun during this artifact repair. The parent remains `planning` until the child evidence is formally reviewed and the follow-up implementation is separately planned.
