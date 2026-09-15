# G7 跨请求稳定占位符(加盐派生)+ notice 残留豁免

## Goal

让同一敏感值在**跨请求**场景下映射到同一占位符（服务进程存活期内稳定），保住上游 Prompt Cache 的字节前缀命中（长会话省费降延迟）；同时把防改写 notice 的示例占位符从 `placeholder_residual` 信号中豁免，消除例行假警报。

## Background

- 现状：`MaskRegistry.mintTag` 用 `randomConsonant5()`（请求级随机）——同一段历史在每个请求里被脱敏成**不同后缀**，上游 Prompt Cache 前缀从历史中第一个占位符处断裂，之后全量 miss（DeepSeek/OpenAI/Anthropic 缓存价差可达 10 倍）。刚完成的字节级 splice 只保住了第一个命中值之前的稳定。
- 调研结论（09-14 perf 任务）：
  - CosyRedactGateway（MIT）：`token = SHA256(原文 + 进程内随机盐)`——无状态、不存原文、运行期内确定性；盐保密 → 上游无法自算映射（Oracle 关闭）
  - maskit：24h TTL 复用表（有原文驻留内存的隐私代价，不采纳）
- **Spec 变更**：09-10 任务 R8 规定"后缀绝不从原文哈希派生"，其论据是**无盐**派生构成上游猜测-验证 Oracle；本任务改为 **HMAC-SHA256(进程密钥, attempt‖category‖value)** 派生——密钥 ≥128 bit、默认进程随机、可用 `PRIVACY_SUFFIX_SECRET` 固定（多副本/重启保持一致）。密钥泄漏则 Oracle 重开，属明示威胁模型边界。已知联动：同值跨用户可由上游关联（与 maskit 复用表同性质），单用户自用可接受，未来可加按会话盐。
- notice 噪声：`PRIVACY_NOTICE_TEXT` 默认文本含示例 `{{EMAIL_trwmq}}`，模型回显 notice 时触发 `placeholder_residual` MEDIUM；真实占位符泄漏会淹没在例行假警报中。

## Requirements

- R1 加盐派生后缀：`mask-tag.ts` 新增 `SuffixDeriver = (category, value, attempt) => string` 与 `createSuffixDeriver(secret)`；默认 deriver 用 HMAC-SHA256 取字节映射到纯辅音字符集（5 位）。密钥解析：`PRIVACY_SUFFIX_SECRET`（≥16 字符）优先，否则 `randomBytes(32)` 进程随机。
- R2 MaskRegistry 适配：构造参数改为 `deriveSuffix: SuffixDeriver`（默认加盐派生，测试可注入）；`mintTag(category, value)` 冲突链：attempt 0→1→2→3 派生，仍冲突则退回随机重掷兜底（保正确性，罕见路径破坏确定性）。
- R3 语义保持：同请求内 同值同 tag、异值异 tag（严格双射）、防套娃/分段保护/占位符文法不变；TAG_RE 5 位纯辅音格式不变。
- R4 notice 豁免：`response-analysis.ts` 从 `PRIVACY_NOTICE_TEXT` 提取示例标签集合，`placeholder_residual` 检测过滤这些精确标签；真实未知标签仍照常告警。
- R5 测试更新与新增：`mask-registry.test.ts` 适配新构造签名（假 deriver 注入、冲突链、隔离）；新增跨请求确定性（两个 registry 同值同 tag）、不同密钥异后缀、双射保持；notice 豁免正负用例。

## Acceptance Criteria

- [ ] AC1 跨请求稳定：同进程内两个独立 registry（模拟两个请求）对同一 (category, value) 产出相同 tag；不同 (category, value) 产出不同 tag。
- [ ] AC2 `PRIVACY_SUFFIX_SECRET` 固定时两个独立 deriver 实例产出相同后缀（模拟重启/多副本）；未固定时两次进程内实例相同、不同进程不同（后者以两个不同 secret 的 deriver 异后缀近似验证）。
- [ ] AC3 冲突链正确：注入 attempt 0 恒撞车的假 deriver，第二个值走 attempt 1；撞满 4 次后退回随机兜底且双射不被破坏。
- [ ] AC4 notice 豁免：含 notice 原文的响应不再产生 `placeholder_residual`；含未知占位符的响应仍产生。
- [ ] AC5 全量 vitest 绿 + build 绿；桌面验证：真实链路两轮同实体请求，上游收到的脱敏字节在占位符处一致（Prompt Cache 前缀稳定）。

## Out of Scope

- 按会话/按用户盐（多租户隔离）；maskit 式原文复用表；重启后的历史映射兼容（客户端持有明文，重脱敏即可，仅丢一次缓存）。
