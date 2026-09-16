# Implement

## Changes

- `src/middleware.ts` — `allowedOrigins()` 增加 `http(s)://<Host 头>` 两个同源候选；`new URL(request.url).origin` 保留（dev/本地兜底），TRUST_PROXY/ALLOWED_ORIGINS/DISABLE_ORIGIN_CHECK 逻辑不动。
- `src/__tests__/middleware-origin.test.ts` — 新增 3 条回归：绑定地址≠访问来源时 Host 同源放行、https Host 同源放行、有 Host 头时跨站仍 403。
- `docker-compose.yaml` — 透传 `TRUST_PROXY` / `ALLOWED_ORIGINS` / `DISABLE_ORIGIN_CHECK`（此前 compose 部署无法设置，逃生舱形同虚设）。
- `README.md` / `.env.template` — 同步说明（同源以 Host 头判定；TRUST_PROXY 适用反代改写 Host 场景）。

## Verification

- 生产 standalone 构建（HOSTNAME=0.0.0.0 PORT=3210）+ curl 矩阵：
  - 修复前：`Referer: http://192.168.1.10:3210/...` → 403；仅 `Origin: http://0.0.0.0:3210`（绑定地址）→ 200（根因实证）。
  - 修复后 10 场景全符合预期：IP/域名/TLS 终结 200；跨站、Origin: null、伪造 X-Forwarded-*（未开 TRUST_PROXY）403；错误 key 401；TRUST_PROXY=1 反代改写 Host 200。
- `npm test`: 44 passed / 478 tests，全绿。
- compose 渲染：本机无 `docker compose` 插件，未跑 `docker compose config`；新增三行为同构透传（沿用既有 `${VAR:-}` 模式），已人工核对。
