# 实现：非法配置值可见化（启动 env 校验告警）

## Goal

对枚举/约束型环境变量做启动期校验：非法值（含拼写错误）以 stderr 告警说明"已按默认值处理"，消除"安全配置静默失效"；不改变任何现有解析行为。

## Background

- 竞品依据：maskit 对"被忽略的配置"做 stderr 双写 + 面板横幅；Cosy 对非法配置值直接 400。我方纯 env 配置、无中间层校验。
- 我方四个实证静默回退点：
  - `config.ts:92-96` `PRIVACY_DISAMBIGUATION_MODE` 非 `off` 一律静默 `auto`（`Off` 拼写错误 → 用户以为关了注入实际还开着）；
  - `config.ts:89` `PRIVACY_MASK_FORMAT` 非 `legacy` 静默 `semantic`；
  - `mask-tag.ts:78-81` `PRIVACY_SUFFIX_SECRET` <16 字符静默回退进程随机 → 跨重启占位符不稳定、Prompt Cache 静默失效；
  - `middleware.ts` `DISABLE_ORIGIN_CHECK`/`TRUST_PROXY` 仅 `==="1"` 生效，设 `true` 静默无效。

## Requirements

- R1 新增 `src/lib/env-check.ts`：`collectEnvWarnings(env)` 纯函数（便于测试）+ `warnInvalidEnv(env)` 经 Logger.warn 输出（stderr）。
- R2 校验集：
  - `PRIVACY_MASK_FORMAT` ∈ {legacy, semantic}；
  - `PRIVACY_DISAMBIGUATION_MODE` ∈ {off, auto} ∪ 旧值 {prefix, json-meta}（旧值合法不告警）；
  - `PRIVACY_SECRET_SCANNER_MODE` ∈ {strict, balanced}；
  - `PRIVACY_DEBUG_HEADERS` ∈ {true, false}；
  - `DISABLE_ORIGIN_CHECK` / `TRUST_PROXY` 必须为 `1`（其它值静默不生效 → 告警）；
  - `PRIVACY_SUFFIX_SECRET` 已设置但 <16 字符 → 告警（回退随机，跨重启不稳定）。
- R3 告警文案含：变量名、实际值、期望值、回退行为；空字符串视为未设置（不告警）。
- R4 挂接 `initializeConfigs()`（一次性守卫内），每进程只输出一轮；只告警不 fail-fast、不改变解析结果。
- R5 测试：合法零告警、逐个非法值告警、旧值合法、短密钥告警、stderr 输出验证。

## Acceptance Criteria

- [ ] AC1 `collectEnvWarnings` 对 6 项规则 + 短密钥的合法/非法矩阵符合预期。
- [ ] AC2 `warnInvalidEnv` 经 `console.warn`（stderr）输出且返回相同告警列表。
- [ ] AC3 `initializeConfigs` 调用后（首次）输出告警且不抛错；二次调用不重复输出（既有 once 守卫）。
- [ ] AC4 全量 `npm test` 绿 + `npm run build` 绿；既有解析行为零变化。

## Out of Scope

- fail-fast 拒绝启动（存量部署兼容风险）；DB 热加载配置项（已有 UI 输入约束）；.env.template 文档补充（可选后续）。

## Open Questions

（无）
