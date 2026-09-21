# 评估：高熵凭据检测升级（bigram 交叉熵，默认关）

## Goal

评估引入"无标签随机凭据"检测（不依赖厂商前缀/敏感键上下文）的落点、算法选型、许可路径与校准方法，产出 go/no-go 与实施草图。本任务不写生产代码。

## Background / 差距

- 我方缺口：**无前缀自建 token**（内部系统 token、随机 session id、密码句柄等）当前全漏——30+ 前缀规则（`secrets.ts` STRONG_RULES）与 PII 规则都不覆盖；`PRIVACY_SECRET_PREFIXES` 只解决"用户自定义前缀"。
- 我方现有高熵仅两处窄场景（Shannon + 固定阈值）：
  - `context-key.ts:305-308`：敏感键上下文内 `shannon >= 3.3(strict)/4.0`；
  - `response-analysis.ts:87`：error_leak 的 `> 3.0`。
- 已知 Shannon 缺陷（Cosy ENTROPY.md 论证 + 常识）：短串经验熵不可分（9 字单词 vs 9 字随机串同为 log2(9)）；hex 字母表把熵上限压到 ~4 bits/char，固定阈值要么误报要么漏报。
- 竞品方案（CosyRedactGateway，Apache-2.0）[实测：worker.js + ENTROPY.md]：
  - `tokenizeBlocks`：`[A-Za-z0-9]+` 块，长度 >8，排除纯数字；保留原始偏移；
  - `entropyScore`：英文 bigram 交叉熵（平滑代价表，含 `^`/`$` 边界；数字与 letter-digit 转换代价高），按 (len+1) 归一；
  - `isHighEntropyBlock`：先过 Shannon 多样性下限 `shannon >= min(2.5, log2(len)*0.72)`（拒绝重复串），再比长度插值阈值（9→5.424 … 128+→4.566 bits/char，线性插值，下限 4.566）；
  - 开关 `H` 独立可选（默认在全开集合里，但可关闭）；
  - 校准：30,000 自然词拼接样本 FP 0.9867%；随机 hex/base62 召回随长度阶梯（9 位 ~91-92%，16 位 >99%，24/32 位 100%）[竞品自测口径]。

## Deliverable

`research/high-entropy-assessment.md`：选项对比（含许可路径）、落点与交互、成本/风险、校准方法、go/no-go 与实施草图。

## Requirements

- R1 算法与常量来源的许可分析：Cosy 已从 MIT 切到 Apache-2.0（含 NOTICE）——直接复用其数值表需保留归属；给出"复用 + NOTICE"与"用自有语料重算表"两条路径的取舍。
- R2 落点设计：新规则（建议 `HIGH_ENTROPY`，默认关）在 secrets 阶段（无关键词预过滤的例外）、与窗口扫描/字节级 splice/性能预算的交互；给出与现有两处 Shannon 的关系（升级 or 保留）。
- R3 性能：评分 O(字符数) 的量级论证 + 基准要求（1MB 文本目标值，待实测）。
- R4 误报面：代码标识符/hash/压缩内容/非英文转写；默认关 + 文档声明的边界（抄 Cosy 的诚实声明风格）。
- R5 校准方法：自然语料 FP 门槛 + hex/base62 召回阶梯的自有 fixtures 设计（语料来源说明）。
- R6 结论：go/no-go + 实施草图（含测试与性能门槛）。

## Acceptance Criteria

- [ ] AC1 文档含 R1-R6；未验证数字标注。
- [ ] AC2 不写生产代码、不改依赖；测试与构建结果与评估前一致。
- [ ] AC3 结论与实施草图可直接被执行任务引用。

## Out of Scope

- 高熵规则的生产实现（若 go，另立实现任务）；对现有 Shannon 阈值的改动（仅评估建议）。
