# Private LLM Gateway

语言：[English](./README.md) | [简体中文](./README.zh-CN.md)

最后检查：2026-07-08

Private LLM Gateway 是一个面向 LLM API 流量的快速隐私反向代理。它会在请求转发到上游 LLM 兼容服务之前扫描请求，脱敏疑似凭证和常见 PII，拦截明显敏感的上传文件名，并把审计元数据记录到本地 SQLite。

```text
client -> private-llm-gateway -> upstream service -> LLM provider
```

## 它做什么

- 将 `/api/*` 请求代理到 `UPSTREAM_URL` 下的同路径接口。
- 支持 OpenAI/Anthropic 风格的 JSON 请求和 SSE 流式响应。
- 在转发前扫描 JSON、纯文本、表单和 multipart 请求。
- 对疑似凭证和常见 PII 先脱敏，再转发给上游。
- 拦截私钥、环境变量、凭证配置等明显敏感的上传文件名。
- 使用 SQLite 保存本地审计元数据，并提供管理后台。
- 运行时配置通过环境变量或后台可编辑配置完成，不在代码里硬编码。

## 它不做什么

- 不解析上传文件内容。
- 不做 OCR、PDF 解析或 Office 文档解析。
- 不用 NLP/语义模型识别人名或地址。
- 不在缺少上下文时把所有“看起来像随机字符串”的内容都当成密钥。

## 快速开始

### 1. 配置应用

```bash
cp .env.template .env
openssl rand -base64 32
```

编辑 `.env`：

```dotenv
UPSTREAM_URL=http://localhost:8787
ADMIN_KEY=<填入生成的管理密钥>
```

不要提交 `.env` 或真实凭证。

### 2. 本地运行

```bash
npm install
npm run dev
```

默认监听地址是 `http://localhost:3000`。

### 3. 通过代理发送请求

`/api/*` 下的请求会去掉 `/api` 前缀后转发到 `UPSTREAM_URL`。

```bash
curl -s http://localhost:3000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"demo-model","messages":[{"role":"user","content":"hello"}]}'
```

如果 `UPSTREAM_URL=http://localhost:8787`，上面的请求会转发到：

```text
http://localhost:8787/v1/chat/completions
```

### 4. 打开管理后台

访问：

```text
http://localhost:3000/dashboard
```

使用 `ADMIN_KEY` 登录。没有设置 `ADMIN_KEY` 时，后台 API 会返回 `503`。

## Docker 部署

生产镜像发布在 GitHub Container Registry：

```text
ghcr.io/wangxinleo/private-llm-gateway:latest
```

启动前编辑 `docker-compose.yaml`：

```yaml
environment:
  NODE_ENV: production
  PORT: 3000
  HOSTNAME: 0.0.0.0
  UPSTREAM_URL: http://host.docker.internal:8787
  DB_PATH: /data/audit.sqlite
  ADMIN_KEY: "<强随机管理密钥>"
```

启动服务：

```bash
docker compose up -d privacy-proxy
```

查看状态和日志：

```bash
docker compose ps
docker compose logs -f privacy-proxy
```

停止服务：

```bash
docker compose down
```

审计数据通过 `/data` 容器挂载持久化到宿主机 `./data/audit.sqlite`。如需清空审计数据：

```bash
docker compose down
rm -rf ./data/audit.sqlite
rm -rf ./data  # 清空整个挂载数据目录
```

如果上游服务跑在 Docker 宿主机上，Docker Desktop 可使用 `http://host.docker.internal:8787`。如果上游服务在同一个 Docker network 中，请改成服务名，例如 `http://your-upstream-service:8787`。

## 运行时配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | Compose 中为 `production` | Node.js 运行环境。 |
| `PORT` | `3000` | Next.js 监听端口。 |
| `HOSTNAME` | Compose 中为 `0.0.0.0` | 容器内绑定的网络接口。 |
| `UPSTREAM_URL` | 直接运行为 `http://localhost:8787` / Compose 中为 `http://host.docker.internal:8787` | 上游服务 base URL。 |
| `DB_PATH` | 直接运行为 `audit.sqlite` / Compose 中为 `/data/audit.sqlite` | SQLite 审计库路径。 |
| `DEBUG` | 生产环境为 `false` | 设置为 `true` 时输出更详细的扫描流程日志。 |
| `ADMIN_KEY` | 空 | 管理后台和 reveal-auth 必填密钥。 |
| `PRIVACY_SECRET_SCANNER_MODE` | `balanced` | 设置为 `strict` 可启用更严格的上下文密钥扫描。 |
| `PRIVACY_MASK_FORMAT` | `explicit` | 脱敏标记格式；`legacy` 用于兼容旧格式。 |
| `PRIVACY_DISAMBIGUATION_MODE` | `auto` | 通过标准提示词字段（`system` / `messages` / `prompt` / `input`）拼接隐私标记说明。可选值：`off`、`prefix`、`auto`。旧值 `json-meta` 会按 `auto` 处理，且不再注入自定义 JSON 字段。 |
| `PRIVACY_NOTICE_TEXT` | 内置说明文本 | 自定义脱敏标记处理说明。 |
| `PRIVACY_DEBUG_HEADERS` | `false` | 启用后，为被脱敏的请求增加调试响应头。 |

后台设置页还可以管理写入 SQLite 的热更新配置：扫描体积阈值、分块大小、上下文密钥限制、bypass 路径选项和扫描排除规则。

## 隐私处理行为

### 支持的请求体

| Content-Type | 处理方式 |
| --- | --- |
| `application/json` | 递归扫描字符串值，并转发脱敏后的 JSON。 |
| `text/plain` | 扫描完整文本请求体。 |
| `application/x-www-form-urlencoded` | 扫描提交的字段值。 |
| `multipart/form-data` | 扫描文本字段，只检查上传文件元数据。 |

### 动作

| 动作 | 含义 |
| --- | --- |
| `allow` | 不修改请求，直接转发。 |
| `mask` | 把命中值替换为隐私脱敏标记后转发。 |
| `block` | 拒绝请求，并返回确定性的 JSON 错误。 |

当前只有敏感上传文件名会被硬拦截。密钥、上下文密钥、连接串、provider token 和 PII 默认会脱敏后转发，这样代码审查和调试工作流可以继续进行，同时不把原始敏感值发送到上游。

### 脱敏类别

扫描器覆盖这些大类：

- 私钥块、授权 token、JWT、Cookie 头、数据库 URI 和连接串。
- Provider / 开发者平台 / 云厂商 token，例如 OpenAI/Anthropic 风格 provider key、GitHub/GitLab/npm/PyPI/Vercel/Linear token、AWS access key、Slack token、Google API key、Stripe key、SendGrid key、base64-like token 和编码后的密钥。
- 出现在高风险字段名附近、形态像 token 的上下文密钥。
- 常见 PII：中国大陆手机号、电子邮箱、中国居民身份证号、银行卡号。

脱敏标记示例：

```text
<<PRIVACY_MASK:EMAIL>>
<<PRIVACY_MASK:BEARER_TOKEN>>
<<PRIVACY_MASK:CONTEXTUAL_SECRET>>
```

### 上传文件元数据拦截

代理不会读取上传文件内容，只按文件名或扩展名拦截：

- 扩展名：`.env`、`.pem`、`.key`、`.p12`、`.pfx`、`.npmrc`、`.pypirc`
- 文件名：`id_rsa`、`id_dsa`、`authorized_keys`、`known_hosts`、`credentials.json`、`service-account.json`、`secrets.yaml`、`secrets.yml`、`prod.env`、`config.prod`

被拦截的请求会返回类似：

```json
{
  "error": "blocked_by_privacy_proxy",
  "blocked_types": ["SENSITIVE_FILENAME"]
}
```

### 请求体大小分级

| 请求体大小 | 扫描行为 |
| --- | --- |
| `< 128 KB` | 完整扫描：密钥、上下文密钥和 PII。 |
| `128 KB - 1 MB` | 分块扫描密钥/上下文密钥，再扫描 PII。 |
| `> 1 MB` | 最小扫描：强密钥规则和 PII。 |

阈值和分块大小可以在后台设置页修改。

## 审计和管理后台

SQLite 审计日志记录请求元数据、命中项、动作、耗时、检测到的模型，以及按类别分组的原始命中值。它不保存完整 prompt，也不保存上传文件内容。

原始命中值不会通过实时 SSE 事件或普通日志发送。后台审计 API 只有在 reveal-auth 成功后才会返回这些值；界面展示时仍会做部分掩码，但认证后可以复制真实值。

请把 SQLite 文件（Docker 部署时为 `./data/audit.sqlite`）当作敏感本地数据保护。

后台页面包括：

- Overview：最近事件和汇总指标。
- Audit：可搜索审计记录、命中类别、命中值 reveal 流程、耗时、模型和 bypass 状态。
- Rules：按路径/模型/时间窗口配置临时 bypass 规则。
- Settings：热更新扫描阈值、路径前缀选项和排除规则。

Bypass 规则会允许匹配请求继续转发，但代理仍会扫描并记录命中项，同时标记 `bypassApplied: true`。

## 项目结构

| 路径 | 作用 |
| --- | --- |
| `src/app/api/[[...path]]/route.ts` | `/api/*` 反向代理入口。 |
| `src/app/api/admin/*` | 审计、统计、配置、reveal auth 和 bypass rules 后台 API。 |
| `src/app/dashboard/*` | 管理后台页面。 |
| `src/scanner/` | 隐私扫描管线：密钥、上下文 key、PII、文件名、multipart 解析和排除规则。 |
| `src/proxy/` | 上游转发、SSE 透传和脱敏标记消歧。 |
| `src/audit/` | SQLite schema、审计写入和实时审计事件。 |
| `src/bypass/` | 临时 bypass 规则存储和匹配。 |
| `Dockerfile` | 使用 Next.js standalone 输出的多阶段生产镜像。 |
| `docker-compose.yaml` | 基于已发布镜像的部署入口。 |
| `.env.template` | 直接 `npm run dev` / `npm start` 时的配置模板。 |
| `doc/` | 额外设计说明。 |

## 开发

安装依赖：

```bash
npm install
```

运行应用：

```bash
npm run dev
```

运行测试：

```bash
npm test
```

构建生产产物：

```bash
npm run build
```

可选：启动本地 mock 上游做手动代理检查：

```bash
node mock-upstream.mjs
```

然后设置 `UPSTREAM_URL=http://localhost:8787`，把请求发送到 `http://localhost:3000/api/...`。

## 安全注意事项

- 使用强随机 `ADMIN_KEY`，并妥善保管。
- 每个环境都显式配置 `UPSTREAM_URL`；不要在源码里硬编码 provider 凭证。
- 不要在没有额外网络控制的情况下公开管理后台或 SQLite 数据目录。
- 只在本地排障时开启 `DEBUG=true`。调试日志会暴露扫描流程细节。
- `audit.sqlite` 会持久化命中值用于泄露统计，应视为敏感数据。

## License

MIT。见 [LICENSE](./LICENSE)。

## 项目历史

下面的时间线基于 Git 提交历史整理，Trellis 任务名只在能说明背景时补充。它是实现日志，不是正式发布公告。

### 2026-06-10

- 初始化 `private-llm-gateway`，确定 Next.js 隐私代理的基本结构。Git：`ccdc70c`。
- 接入自动构建流程，运行安装、测试和生产构建。Trellis：`Git automatic build workflow`；Git：`7e58857`。
- 启动 Docker 镜像发布方向，后续落到 `Publish Docker image to GHCR`。

### 2026-06-15

- 统一环境变量配置和 Docker/Compose 工作流，减少本地、容器、生产运行之间的差异。Git：`44569e2`、`5eddc7a`。
- 增强敏感信息检测配置和测试，并加入调试模式，方便排查扫描过程。Git：`253367b`、`fe7e807`。

### 2026-06-16

- 补充代理日志、错误处理、调试输出和相关文档配置。Git：`310ee42`。
- 新增管理后台、导航结构和 i18n 基础能力。Git：`5e3cbe4`。

### 2026-06-17

- 升级隐私脱敏标记格式，并加入请求级语义消歧，减少误解和上下文丢失。Git：`1d4465d`。
- 修复前端运行时配置读取方式，改为通过服务端 API 获取环境变量。Git：`694c191`。
- 新增 `ADMIN_KEY` 管理后台认证、根路径跳转 dashboard 和管理员上下文初始化。Git：`c445c1a`、`914d5e1`、`b9b0f8a`。
- 优化后台文字尺寸、审计表时间范围筛选和 i18n 文案。Git：`54a8c71`、`b565f0e`。

### 2026-06-18

- 更新集成测试，使用本地 HTTP server 模拟上游请求，让代理转发测试更稳定。Git：`8d23b7f`。

### 2026-06-23

- 新增临时 bypass 规则，可在配置时间窗口内跳过隐私阻断。Git：`9753c7c`。
- 实现系统配置热更新，并开始优化管理后台体验。Git：`ab5a255`。
- 同期 Trellis bypass 相关任务：`Make bypass rule path prefix options configurable via admin settings`、`Merge path prefix options in audit log filter with configured path_prefix_options`、`Optimize temporary bypass rule time and path selection UX`。

### 2026-06-24

- 调整路径前缀选项，移除 API 版本前缀，让筛选和规则更贴近实际上游路径。Git：`96bfdec`。
- 更新后台 UI，加入临时 bypass 规则管理并优化 i18n 文案。Git：`ce7e220`。
- 同期 Trellis 清理任务：`Fix incorrect default path prefix configuration`、`Update all documentation references from scan rules to bypass rules`、`Update nav.rules translation from scan rules to bypass rules`、`Fix dashboard recent incidents to show both block and mask actions`。

### 2026-06-25

- 增加审计命中值 reveal 认证机制，并优化上下文密钥扫描。Git：`4050aaa`。
- 到这一阶段，GHCR 发布、bypass 路径选项、审计筛选、临时 bypass UX、默认路径配置和术语迁移基本完成。

### 2026-06-26

- 审计记录新增模型字段，并同步更新相关接口和 i18n 文案。Git：`994f22a`。
- 修复页面切换后需要重新输入 reveal 密钥的问题。Git：`1629821`。
- 支持重新启用 bypass 规则，并修复预存类型处理。Git：`e004d49`。
- 加入 Trellis 项目管理说明和协作指令。Git：`e18da49`。

### 2026-06-29

- bypass 放行时仍扫描并记录命中项，同时记录 bypass 状态，方便后续风险分析。Git：`26eae87`。

### 2026-06-30

- 更新隐私通知文本，说明脱敏标记应如何处理。Git：`31fcaef`。
- 新增扫描排除规则，支持 exact 和 regex 模式，并同步配置和界面。Git：`c8e9c85`。

### 2026-07-02

- 增加 `BASE64_TOKEN`、`STRIPE_KEY`、`SENDGRID_KEY` 检测；审计耗时改为可空；后台加入耗时列。Git：`c519824`。

### 2026-07-03

- 增强审计日志和原始命中值处理能力。Git：`3459638`。
- 管理后台 SSE 改为 header-only auth，减少认证信息暴露面。Git：`fac341f`。

### 2026-07-06

- 修复 LLM JSON 代理请求中的密钥脱敏保留问题。Git：`cc70080`。
- 调整前端实现细节。Git：`6bea77b`。
- Trellis 对齐：`Align LLM privacy proxy design`，把 README 范围收敛为 LLM API 隐私网关、快速扫描、SSE 透传、SQLite 审计和 Docker 部署。

### 2026-07-07

- 修复审计页面溢出、语言按钮样式、dashboard 命中标签，并继续打磨 dashboard 视觉。Git：`d66ea08`、`22d48cf`、`551c9fd`。
- 修复扫描器配置密钥泄露漏检。Trellis：`Fix secret configuration leakage`；Git：`8e01f7b`。
- 扩展扫描器密钥规则包，覆盖更多 LLM provider token、开发者平台 token、云厂商/配置凭证、连接串、高熵值和 base64 编码配置。Git：`d474680`。
