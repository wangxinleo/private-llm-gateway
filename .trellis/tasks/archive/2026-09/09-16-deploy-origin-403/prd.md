# 修复部署后管理面来源校验误杀(登录403)

## Goal

修复 Docker/反代部署后浏览器登录被 403 `origin_not_allowed` 拦截，控制台不可用的问题。

## Root Cause（已实证）

- `src/middleware.ts` 以 `new URL(request.url).origin` 作为同源基准，但 Next.js 用**服务端绑定地址**构造 `request.url`（standalone 为 `http://0.0.0.0:<PORT>`，dev 为 `localhost:<PORT>`），与浏览器实际来源（`http://<server-ip>:<port>` / `https://<domain>`）永不相等 → 真实浏览器同源请求全部 403。生产构建复现：仅 `Origin: http://0.0.0.0:3210` 放行。
- `docker-compose.yaml` 未透传 `TRUST_PROXY` / `ALLOWED_ORIGINS` / `DISABLE_ORIGIN_CHECK`，README 记载的三个配置手段在 compose 部署下全部失效。

## Requirements

- 同源判定以请求 `Host` 头为准（http/https 均纳入）；`x-admin-key` 仍为主防线。
- 安全语义不回退：跨站 Origin / `Origin: null` / 未开 TRUST_PROXY 时伪造 `X-Forwarded-*` 均 403。
- compose 透传三个来源校验变量；README / .env.template 同步。

## Acceptance Criteria

- [x] standalone 生产构建：IP 直连 / 域名(Host 保留) / TLS 终结反代 三种浏览器场景登录 200。
- [x] 跨站 Origin、`Origin: null`、伪造 `X-Forwarded-*`（未开 TRUST_PROXY）403；错误 key 401。
- [x] TRUST_PROXY=1 反代改写 Host 场景 200，未开启时保持 403。
- [x] 全量单测 478 绿（新增 3 条回归）。
