# 高风险资产下线与词库页整合

## Goal

高风险资产（域名/邮箱/账户白名单作窗口锚点）与敏感词库功能定位重复，整体下线前者的代码与配置面；同时把 Settings 页的「内置规则开关」「自定义密钥前缀」UI 移入敏感词库页，形成单一词库/规则管理入口。

## Background

- 高风险资产机制：`HIGH_RISK_ASSETS`（domains/emails/accounts，支持 `*` 通配）命中值作为窗口扫描锚点（`src/scanner/context-window.ts`），窗口内扫描 secrets/context-key/EMAIL。
- P3 已上线自定义词库（全文 mask + 还原），两者「用户自定义敏感目标」的定位重叠（产品决策，2026-09-14 用户确认下线）。
- 下线后窗口锚点仅剩**敏感键值对**（api_key=/password: 等四类键），secrets/context-key 的窗口扫描语义不变。

## Requirements

- R1 删除高风险资产：`src/scanner/high-risk-assets.ts`、`HIGH_RISK_ASSETS`/`DEFAULT_HIGH_RISK_ASSETS`（config）、`HighRiskAssets` 类型、config-loader 加载/热更、admin config GET/PUT 的 `high_risk_assets` 键、`isHighRiskAssets` 帮助函数、Settings 高风险资产卡片；`scanContextWindows` 去掉 assets 参数。存量 DB `system_config.high_risk_assets` 行不再读取（无需迁移）。
- R2 UI 整合：Settings 页删除「内置规则开关」「自定义密钥前缀」两卡（`secret_prefix_min_length` 一并迁出「引擎行为」卡）；敏感词库页新增「内置规则开关」与「自定义密钥前缀（含最短密文位数）」两卡，复用 /api/admin/config 读写与热加载。
- R3 语义保持：窗口扫描 = 敏感键值对锚点 ±CONTEXT_WINDOW 半径；PHONE/ID/BANK 全文扫、EMAIL 仅窗口内；词库/规则开关/前缀行为不变。
- R4 测试同步：context-window/pipeline 测试从白名单语义改写为锚点语义；admin-config-stats mock 去除相关键。

## Acceptance Criteria

- [ ] AC1 `grep -r "high.risk\|HighRiskAssets\|HIGH_RISK" src benchmarks` 零命中（存档任务文档除外）。
- [ ] AC2 敏感词库页含规则开关（33+1 类）与前缀管理卡；Settings 页不再含这两卡与高风险资产卡。
- [ ] AC3 锚点语义测试绿：锚点窗口内 secrets/EMAIL 命中、窗外不扫、PHONE 全文不受锚点限制。
- [ ] AC4 `npm run build` + 全量 vitest 绿；桌面验证两页 UI 与脱敏主链路不回归。

## Out of Scope

- system_config 存量 high_risk_assets 行的 DB 清理；path_prefix_options（bypass 用）不受影响。
