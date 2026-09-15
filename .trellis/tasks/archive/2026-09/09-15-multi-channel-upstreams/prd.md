# G3 多渠道上游路由 + Clients 管理页

## Goal

单 `UPSTREAM_URL` 扩展为多渠道：`/api/<channel>/**` 按渠道名路由到对应上游（strip 渠道前缀后同路径转发），Dashboard 新增 Clients 页 CRUD + 热加载；空表时与现状逐字节兼容（默认渠道兜底）。

## Background

- 前序任务（maskit 差距评审）已定形态：Dashboard CRUD + SQLite 热加载，`UPSTREAM_URL` 保留为默认渠道；曾被剔除另立，现实施。
- 参考形态（maskit upstreams）：name/base_path/port/target/paths/extra_headers——我们按路径前缀而非独立端口（Next 单服务器形态）。
- 保留段：`src/app/api/` 下现有具体路由目录仅 `admin`（具体路由优先于 catch-all，渠道名撞保留段将不可达，CRUD 层拒绝）。
- 安全红线（maskit 教训 #8）：extra_headers 不得覆盖调用方已有 header、不得注入凭据/协议关键头。

## Requirements

- R1 数据层：`upstreams` 表（id、name UNIQUE、target、extra_headers JSON、enabled、created_at）；`src/upstreams/store.ts` CRUD + 启用列表 + 内容版本号缓存（同 words 模式）。
- R2 路由：`src/proxy/channels.ts` `resolveChannel(path, upstreams)`——`/^\/([a-z0-9-]{1,32})(\/.*)?$/` 首段匹配 enabled 渠道且非保留段（admin）；命中返回 `{name, target, forwardPath, extraHeaders}`；未命中/null 回落 `UPSTREAM_URL`（现状语义）。
- R3 转发：`forwardRequest` 增可选 channel 参数——URL = `target + forwardPath`（含 query）；extra_headers 合并仅限调用方**未持有**的键（大小写不敏感）；调用方签名兼容（无渠道时不传第四参，既有测试零改动）。
- R4 audit/bypass 语义：审计与 bypass 规则仍用**原始路径**（含渠道前缀）；扫描/还原/响应分析链路与渠道无关。
- R5 管理面：`/api/admin/upstreams` CRUD——name `^[a-z0-9][a-z0-9-]{0,31}$` 且非保留段、唯一；target 必须 http/https（归一化去尾斜杠）；extra_headers 为 string→string 对象且键不得为凭据/协议黑名单（authorization/proxy-authorization/x-api-key/api-key/cookie/set-cookie/host/content-length/content-type）；启停开关。
- R6 Dashboard：新增 Clients 页（列表：渠道名/目标/额外头/状态/启停/删除；表单：name/target/extra_headers JSON 编辑；渠道使用提示 `/api/<name>/...`）+ 侧栏 + 中英 i18n。
- R7 兼容：upstreams 空表 = 现状逐字节一致；渠道变更热加载（版本缓存失效）。

## Acceptance Criteria

- [ ] AC1 配置渠道 `foo→https://api.example.test` 后 `POST /api/foo/v1/chat/completions?x=1` 转发到 `https://api.example.test/v1/chat/completions?x=1`；无前缀请求仍走 `UPSTREAM_URL`；停用渠道立即回落默认。
- [ ] AC2 extra_headers 生效且不覆盖调用方同名头；CRUD 拒绝黑名单键与非法 name/target/保留段。
- [ ] AC3 审计记录原始路径（含渠道前缀）；bypass 规则按原始路径匹配（测试锁定）。
- [ ] AC4 Clients 页 CRUD/启停可用，热加载生效；中英 i18n 与暗色正常。
- [ ] AC5 全量 vitest 绿 + build 绿；桌面验证：真实链路经渠道转发到第二 mock 上游、默认渠道不回归、UI CRUD 实测。

## Out of Scope

- 独立端口多监听、per-channel 扫描策略（规则仍全局）、egress 二级代理。
