# 枚举硬化:取消隐式默认路由 + 渠道随机前缀 + 默认上游回填

## Goal

取消"无渠道前缀请求必有默认上游"的隐式行为：`UPSTREAM_URL` 变为**可选**——未设置时无前缀/未匹配路径直接 404（外网枚举常见 API 路径一无所获）；渠道名前缀支持长随机码（≤64 位）并在 UI 提供生成按钮；Clients 页展示环境变量默认上游并支持一键预填回填为渠道。

## Background

- 现状：`config.ts` 硬编码 `process.env.UPSTREAM_URL ?? "http://localhost:8787"`——不回显式配置也总有隐式默认上游，无前缀请求可被枚举利用（扫描 `/api/v1/chat/completions` 即命中转发）。
- 用户场景（2026-09-15）：网关暴露外网时，入口前缀应为一串随机码（秘密路径访问控制），常见路径探测全部 404。
- G3 已就绪：渠道 CRUD/热加载/路由/extra_headers 黑名单；本任务在其上做路由语义变更 + UI 增强。
- 兼容约束：docker-compose/存量部署设置了 `UPSTREAM_URL` 的继续按现行为工作（无前缀走它）；e2e 测试设置该 env，不受影响；单元测试由 vitest setup 统一注入（模拟"默认上游已配置"）。

## Requirements

- R1 `UPSTREAM_URL` 可选化：config 移除硬编码默认值，新增 `getDefaultUpstream(): string | null`（实时读 env，空串/null 视为未设置）；admin config 的 env 展示 `upstreamUrl` 取 `getDefaultUpstream() ?? ""`。
- R2 无默认路由语义：`handleRequest` 在 extractPath/resolveChannel 后、读 body 前判定——渠道未命中且无默认上游 → **立即 404** `{error:"not_found"}`（不扫描、不转发、不审计，仅 debug 日志）；有默认上游时无前缀请求按现行为走它。
- R3 渠道名随机前缀：名称上限 32→64（`^[a-z0-9][a-z0-9-]{0,63}$`，resolveChannel 同步扩大）；Clients 表单「生成随机前缀」按钮（24 位随机小写字母数字，crypto 强随机）+ 防枚举用法提示。
- R4 回填：Clients 页新增「默认上游（环境变量）」状态卡——未设置时明示"无前缀请求将 404（防枚举模式）"；已设置时显示目标 + 「回填为渠道」按钮（自动生成随机名、预填目标到创建表单，用户确认后提交，不隐式写入）。
- R5 文档：README 环境变量与接入章节、.env.template、docker-compose 注释同步（UPSTREAM_URL 可选；防枚举模式说明；渠道前缀接入方式）。
- R6 测试：vitest setupFiles 注入默认 `UPSTREAM_URL`（存量测试零改动）；新增：无默认上游 404（不调用 forwarder/不审计）、有默认上游回落、64 位名通过/65 位拒绝、resolveChannel 长名匹配、随机前缀生成器格式。

## Acceptance Criteria

- [ ] AC1 未设 UPSTREAM_URL：`POST /api/v1/chat/completions` → 404 且 forwarder 未被调用、无审计记录；`POST /api/<渠道名>/v1/chat/completions` 正常。
- [ ] AC2 设置 UPSTREAM_URL（含 compose 形态）：无前缀请求按现行为转发（存量兼容）。
- [ ] AC3 渠道名 24 位随机码可创建、可路由；UI「生成随机前缀」一键填充；64 位上限生效。
- [ ] AC4 Clients 页默认上游状态卡（两种状态）+ 回填预填流程可用；i18n 中英。
- [ ] AC5 全量 vitest 绿 + build 绿；桌面验证：无默认上游模式 404、随机前缀渠道端到端、默认上游模式兼容、UI 生成/回填交互。

## Out of Scope

- 渠道级鉴权 token（秘密路径仅访问控制的一层，非替代鉴权）；默认上游的 DB 持久化迁移（env 保持为唯一来源）。
