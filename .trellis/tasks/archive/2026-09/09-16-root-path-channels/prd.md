# 根路径渠道前缀:移除 /api/ 固定段

## Goal

代理入口从 `/api/<channel>/**` 迁移到根路径 `/<channel>/**`——用户完全自定义入口路径（如随机码 `/<24位码>/v1/chat/completions`），不再有固定的 `/api` 段；管理端保留 `/api/admin/*`。

## Background

- 现状：代理 catch-all 在 `src/app/api/[[...path]]/route.ts`，extractPath 剥 `/api`；渠道与管理端共用 `/api` 段。
- 用户诉求（2026-09-16）：去掉 `/api/` 固定段，渠道前缀直接落在根路径，随机码入口更干净且不暴露网关约定（`/api/*` 是常见探测模式）。
- 影响面已摸清：7 个测试文件 import 路由 + 构造 `/api...` URL；e2e 用 `${BASE}/api/post`（×4，管理端 /api/admin 保持）；i18n/README/compose 文案含 `/api/`。
- Next 路由兼容：根 `[...path]`（非可选 catch-all）与 `page.tsx`（`/`）不冲突；`dashboard/ api/ fonts/` 等具体段优先匹配，其余落入 catch-all。
- 破坏性变更：Base URL 含 `/api` 的存量工具配置需去掉该段（README 迁移说明）。

## Requirements

- R1 路由迁移：`src/app/api/[[...path]]/route.ts` → `src/app/[...path]/route.ts`；`extractPath` 不再剥 `/api`（path = pathname+search 原样）；删除旧文件；`/api/admin/*` 具体路由不受影响。
- R2 保留段更新：根级保留 = {`api`, `dashboard`, `admin`, `health`}（`api`=管理端树、`dashboard`=控制台页、`admin`/`health` 防混淆与约定保护）；渠道名/解析正则其余不变（`[a-z0-9][a-z0-9-]{0,63}`）。
- R3 转发语义：渠道命中 strip `/<channel>` 后转发；默认上游模式（UPSTREAM_URL 设置）无匹配路径**原样**转发（不再有 /api 剥离逻辑）；防枚举模式（未设置）无匹配 → 404（不读 body/不审计）。
- R4 文案与文档：Clients 页渠道显示 `/{name}/...`、hint/createDesc、settings 路径前缀占位符、README（接入示例改根路径+迁移说明）、compose 注释。
- R5 测试：7 个路由测试 import 路径与 URL 基址更新；e2e `/api/post`→`/post`；新增：根路径渠道路由、保留段 api/dashboard 拒绝、默认上游模式根路径原样转发；vitest.setup 不变。

## Acceptance Criteria

- [ ] AC1 设置渠道 `k7x...→target` 后 `POST /k7x.../v1/chat/completions` 转发到 `target/v1/chat/completions`；`/api/k7x.../v1/...` 不再按渠道处理（enum 模式 404 / legacy 模式原样转发含 /api）。
- [ ] AC2 `/api/admin/*` 管理端与 `/dashboard/*` 控制台不受影响；根 `/` 正常。
- [ ] AC3 防枚举模式：`/v1/chat/completions`→404 零审计；`/<随机码>/v1/...` 端到端（脱敏/还原/审计）。
- [ ] AC4 默认上游模式：`POST /v1/chat/completions`（无 /api）转发到 `UPSTREAM_URL/v1/chat/completions`。
- [ ] AC5 全量 vitest 绿 + build 绿；桌面验证：根路径随机前缀端到端（真实点击建渠道）、enum 404、管理端/控制台无回归。

## Out of Scope

- `/api/<channel>` 兼容别名（用户明确去掉；README 提供迁移说明）。
