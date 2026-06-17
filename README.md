# 快速隐私代理（Fast Privacy Proxy）v1

## 目标

这个目录用于说明一个本地快速隐私代理在 v1 阶段的明确范围。

目标链路：

`client -> privacy-proxy -> upstream-service -> LLM provider`

这个版本重点追求低延迟和可预测的行为。

## 非目标

- v1 不解析文件内容。
- 不做 OCR、PDF 解析或 Office 文档解析。
- 不做基于 NLP 或语义的 PII 识别。
- 不尝试在没有上下文的情况下识别所有看起来随机的密钥字符串。

## 核心行为

- 代理是位于上游服务前面的透明 HTTP 反向代理。
- 所有进入的请求都会在转发前先被检查。
- 文本字段会扫描高风险密钥和基础个人信息。
- 文件上传仅检查文件名、扩展名和 MIME 类型。
- 类似凭证的敏感内容会被直接拦截。
- 基础身份信息会先脱敏，再继续转发。
- 敏感文件名会在不读取文件内容的前提下直接拦截。

## 请求覆盖范围

v1 支持处理以下请求类型：

- `application/json`
- `text/plain`
- `application/x-www-form-urlencoded`
- `multipart/form-data`

默认处理方式：

- JSON：递归扫描所有字符串值。
- 纯文本：扫描整个请求体。
- 表单：扫描所有字段值。
- Multipart：扫描文本字段；上传文件只检查元数据。

## 快速模式策略

这个版本使用快速策略配置。

### 动作

- `block`：拒绝请求，并返回明确原因。
- `mask-and-forward`：替换匹配到的 PII 后继续转发。
- `allow`：不做修改，直接转发。

### 拦截内容

当文本字段中检测到以下任一内容时，立即拦截：

- 私钥标记，例如 `-----BEGIN PRIVATE KEY-----`
- Bearer Token 模式
- JWT 模式
- Cookie 头样式的会话内容
- 内嵌凭证的数据库 URI
- 带有密钥上下文字段且值表现为长随机字符串的内容

高风险上下文字段示例：

- `api_key`
- `apikey`
- `token`
- `access_token`
- `refresh_token`
- `secret`
- `secret_key`
- `client_secret`
- `authorization`
- `cookie`
- `session`
- `sessionid`
- `password`
- `passwd`

快速模式不会因为“长得像随机串”就单独拦截所有内容。只有当随机值出现在类似密钥的上下文中时，才会触发拦截。

### 脱敏内容

当检测到以下常见 PII 模式时，执行脱敏后转发：

- 中国大陆手机号
- 电子邮箱地址
- 中国居民身份证号
- 银行卡号

建议替换标记：

- `[PHONE]`
- `[EMAIL]`
- `[ID_CARD]`
- `[BANK_CARD]`

## 文件上传策略

在 v1 中，不解析上传文件的内容。

代理只检查：

- 文件名
- 扩展名
- MIME 类型

### 拦截的文件名和扩展名

如果文件名或扩展名匹配以下任一项，立即拦截：

- `.env`
- `.pem`
- `.key`
- `.p12`
- `.pfx`
- `id_rsa`
- `id_dsa`
- `authorized_keys`
- `known_hosts`
- `credentials.json`
- `service-account.json`
- `secrets.yaml`
- `secrets.yml`
- `prod.env`
- `config.prod`
- `.npmrc`
- `.pypirc`

### 可选拦截的文件类型

以下类型建议作为可配置项，不强制纳入快速模式的默认拦截：

- `.sql`
- `.db`
- `.sqlite`
- `.bak`
- `.zip`
- `.7z`
- `.rar`

快速模式的默认建议：

- 拦截明显的凭证类文件
- 放行普通文档和代码文件
- 不检查文件内容

## 检测模型

v1 的检测策略刻意保持简单。

### 强规则

以下结构性特征一旦直接匹配，就始终拦截：

- JWT
- Bearer Token
- Cookie 头样式数据
- 私钥头
- 带密码的数据库 URI

### 上下文密钥规则

当以下两个条件同时满足时进行拦截：

- 存在类似密钥的字段名或附近关键字
- 对应的值看起来像高熵 token 或 session 字符串

针对值的初始形态建议：

- 长度在 `20` 到 `200` 之间
- 字符主要来自 `[A-Za-z0-9._-]`
- 不具备明显自然语言的空格分布

### PII 规则

仅使用基于正则的脱敏规则。

v1 不做语义层面的人名或地址识别。

## 性能规则

这个版本优先保证速度。

### 请求体大小阈值

- `< 128 KB`：完整扫描所有受支持的文本字段
- `128 KB - 1 MB`：对文本字段做分块扫描
- `> 1 MB`：只执行强密钥规则和基础 PII 脱敏

### Multipart 行为

- 检查 multipart 文本字段
- 只检查文件元数据
- 不读取文件内容进行扫描

### 提前退出

- 一旦确认命中拦截条件，立即停止后续扫描

## 响应行为

当请求被拦截时，返回确定性的 JSON 响应，例如：

```json
{
  "error": "blocked_by_privacy_proxy",
  "blocked_types": ["JWT", "SENSITIVE_FILENAME"]
}
```

当请求被脱敏后转发时：

- 不暴露原始内容
- 仅在本地环境调试时，可选附加内部响应头

## 日志与审计

只记录元数据。

### 日志模式

系统支持两种日志模式,通过环境变量 `DEBUG` 控制:

**生产模式 (DEBUG=false 或未设置)**:
- 仅输出命中规则的请求摘要
- 格式: `[proxy] METHOD PATH | action: ACTION | hits: CATEGORIES | DURATION ms`
- 示例: `[proxy] POST /v1/chat/completions | action: mask | hits: BEARER_TOKEN, PHONE | 12.34ms`
- allow 放行的请求不产生日志,降低噪音

**调试模式 (DEBUG=true)**:
- 输出完整扫描流程
- 包括请求预览、扫描层级、命中详情等
- 用于故障排查和开发调试

建议记录字段：

- 时间戳
- 请求路径
- 请求方法
- 内容类型
- 请求体大小
- 文件名
- 命中类别
- 执行动作
- 处理耗时

不要记录：

- 原始提示词文本
- 密钥值
- 脱敏前的原始值
- 原始文件内容

## 当前实现拆分

当前项目使用 Next.js Route Handler 实现透明代理：

- `src/app/api/[[...path]]/route.ts`：接收 `/api/*` 请求，执行扫描、审计和转发。
- `src/scanner/`：隐私扫描管线，包括凭证、上下文密钥、PII、文件名和 multipart 元数据检查。
- `src/proxy/`：上游转发与 SSE 响应透传。
- `src/audit/`：SQLite 审计元数据写入。
- `Dockerfile`：生产镜像，使用 Next.js standalone 输出。
- `docker-compose.yaml`：本地和生产部署入口。

## Docker 部署设计

### 镜像策略

- 使用 `node:22-alpine` 多阶段构建。
- 构建阶段运行 `npm ci` 和 `npm run build`，生成 Next.js standalone 输出。
- 运行阶段只复制 `.next/standalone`、`.next/static` 和 `public`。
- GitHub Actions 会在 `master` 分支发布镜像到 GitHub Container Registry (`ghcr.io/<owner>/<repo>:latest`)，并在 `v*` Git tag 上发布版本镜像。
- `better-sqlite3` 是原生模块，builder 和 runner 使用同一个 Alpine 基础镜像以保持 ABI 一致。
- 容器以 `node` 非 root 用户运行。
- 审计数据库固定写入 `/data/audit.sqlite`，通过宿主机目录映射 `./data` 持久化（bind mount）。
- 健康检查访问代理根路径 `/`，只验证代理进程存活，不依赖上游服务。

### 运行时配置

所有配置通过环境变量注入，参考 `.env.template` 创建 `.env` 文件。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | Node 运行环境 |
| `PORT` | `3000` | 容器内 Next.js 监听端口 |
| `HOSTNAME` | `0.0.0.0` | 容器内绑定的网络接口 |
| `TZ` | `Asia/Shanghai` | 容器时区，影响日志时间戳 |
| `DEBUG` | `false` | 调试模式。`true` 显示详细日志,`false` 仅显示关键信息 |
| `HOST_PORT` | `3000` | 映射到宿主机的端口（仅用于 Docker Compose） |
| `UPSTREAM_URL` | `http://upstream-service:8787` | 上游服务的 base URL（被代理的目标服务地址） |
| `DB_PATH` | `/data/audit.sqlite` | SQLite 审计库路径 |
| `ADMIN_KEY` | _(空)_ | 管理后台访问密钥。必须设置才能访问 `/dashboard`。建议使用 `openssl rand -base64 32` 生成 |

生产环境配置：

```bash
# 从模板创建配置文件
cp .env.template .env
# 编辑 .env 填入生产配置
```

**必须设置 ADMIN_KEY 才能访问管理后台**：

```bash
# 生成强随机密钥
openssl rand -base64 32
# 将生成的密钥填入 .env 文件的 ADMIN_KEY 变量
```

如果上游服务是同一个 Compose 项目里的服务，保持：

```env
UPSTREAM_URL=http://upstream-service:8787
```

如果上游服务跑在宿主机上，Docker Desktop 可使用：

```env
UPSTREAM_URL=http://host.docker.internal:8787
```

Linux 服务器上更推荐把上游服务和 `privacy-proxy` 放进同一个 Docker network，并使用服务名访问。

### 生产启动

使用仓库源码在服务器本地构建：

```bash
docker compose up -d --build privacy-proxy
```

或直接拉取 GitHub Container Registry 中的镜像：

```bash
# 替换为你的仓库地址
docker pull ghcr.io/<your-username>/<your-repo>:latest
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

审计数据存储在宿主机 `./data/audit.sqlite`。如需清空审计数据：

```bash
# 停止服务
docker compose down
# 删除审计数据库
rm -rf ./data/audit.sqlite
# 或清空整个数据目录
rm -rf ./data
```

### 本地容器烟测

项目提供 `mock-upstream.mjs` 模拟上游服务。使用 `mock` profile 可以在没有真实上游的情况下验证容器链路：

```bash
docker compose --profile mock up -d --build
```

允许并转发普通请求：

```bash
curl -s http://localhost:3000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
```

脱敏后转发 PII：

```bash
curl -s http://localhost:3000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

拦截敏感文件名：

```bash
curl -s -w "\n%{http_code}\n" http://localhost:3000/api/v1/upload \
  -H "Content-Type: multipart/form-data; boundary=----TestBoundary123" \
  --data-binary $'------TestBoundary123\r\nContent-Disposition: form-data; name="file"; filename="id_rsa"\r\nContent-Type: application/octet-stream\r\n\r\nfake\r\n------TestBoundary123--\r\n'
```

烟测完成后：

```bash
docker compose --profile mock down
```

## v1 已确认的问题结论

- 是否透明代理：是
- 是否过滤所有请求：是
- 是否解析文件内容：否
- 是否拦截敏感文件名：是
- PII 如何处理：脱敏后转发
- 凭证如何处理：直接拦截
- 未知随机字符串如何处理：仅在上下文显示其可能是密钥时拦截

## 推荐下一步

如果后续确实有需要，可以再实现 `balanced` 模式；但当前建议先从这个快速配置开始：

- 低延迟
- 运维复杂度低
- 对明显的凭证泄露有较强保护
- 相比激进的随机字符串拦截，误报更可控
