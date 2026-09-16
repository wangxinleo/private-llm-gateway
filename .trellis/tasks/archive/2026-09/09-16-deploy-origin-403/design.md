# Design — 部署后管理面来源校验误杀(登录403)

> 对应 prd.md。目标：修掉「部署后登录一律 403」，不放松跨站防护；顺带打通 compose 部署对来源校验变量的可配置性。

## 1. 根因（生产构建实证）

middleware 的同源基准为 `new URL(request.url).origin`，但 Next.js 在非 Vercel 运行时用**服务端绑定地址**构造 middleware 的 `request.url`：

- `node_modules/next/dist/server/next-server.js:1266` — `initUrl = this.n && this.port ? `${protocol}://${this.n}:${this.port}${req.url}` : trustHostHeader ? https://Host... : req.url`（`this.n` = 绑定 hostname）
- 仅当 `experimental.trustHostHeader`（CI/Vercel hasNextSupport 自动开启）才以 Host 头构造。

standalone 实测（HOSTNAME=0.0.0.0 PORT=3210，旧代码）：

| 请求来源 | 结果 |
| --- | --- |
| `Referer: http://192.168.1.10:3210/dashboard`（真实浏览器同源） | **403** |
| `Origin: http://127.0.0.1:3210` | **403** |
| `Origin: http://0.0.0.0:3210`（绑定地址，浏览器永不产生） | 200 |

→ Docker/反代部署下任何真实浏览器同源请求必 403；dev 的 `localhost:3000` 恰好命中绑定值，掩盖了 bug（「本地正常、部署即挂」）。

次生问题：`docker-compose.yaml` 未透传 `TRUST_PROXY` / `ALLOWED_ORIGINS` / `DISABLE_ORIGIN_CHECK`，文档化的三个控制项在 compose 部署下不可用。

## 2. 方案

同源候选 = `request.url` origin（保留，dev/本地兜底）+ `http(s)://<Host 头>`：

- Host 头是浏览器真实访问地址（浏览器不可伪造该 forbidden header）；终端 scheme 服务端不可感知 → http/https 双纳入。
- 跨站攻击面不变：攻击页 fetch 的 Host=网关，但 Origin/Referer=攻击页 → 仍 403；`x-admin-key` 仍是主防线。
- `TRUST_PROXY=1`（信任单跳 X-Forwarded-Proto/Host，覆盖反代改写 Host 场景）、`ALLOWED_ORIGINS` 精确匹配、`DISABLE_ORIGIN_CHECK` 逃生舱——语义均不变。
- compose 三变量从 `.env` 插值透传（`${VAR:-}`，沿用既有模式）。

## 3. 备选与取舍

- **ALLOWED_ORIGINS 子域通配**（如 `https://*.wangxinleo.fnos.net`）：用户 fnos 隧道前缀每次重启随机重生成，若隧道改写 Host 且不带 X-Forwarded-Host 则需要；当前隧道行为未实测，留作后续能力（实测后按需实现）。
- **`experimental.trustHostHeader`**：仅 CI/Vercel 自动开启，不依赖。
- **直接 `DISABLE_ORIGIN_CHECK=1`**：仅逃生舱，不作默认。

## 4. 验证（生产 standalone，修复后 10 场景）

| # | 场景 | 结果 |
| --- | --- | --- |
| 1-3 | IP 直连 / 域名 Host 保留 / TLS 终结反代 | 200 |
| 4-6 | 跨站 Origin、`Origin: null`、未开 TRUST_PROXY 伪造 X-Forwarded-* | 403 |
| 7 | 错误 key | 401 |
| 8 | 反代改写 Host 且未开 TRUST_PROXY | 403 |
| 9-10 | 同场景 + `TRUST_PROXY=1` → 200；其跨站 Origin → 403 | 通过 |

单测：`middleware-origin.test.ts` 10 条（新增 3 条回归）；全量 478 绿。
