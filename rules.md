# 快速隐私代理规则（Fast Privacy Proxy Rules）v1

## 目的

这个文件定义了快速模式隐私代理使用的具体检测规则。

目标是在保持低延迟的同时，拦截明显的凭证泄露，对常见 PII 做脱敏，并尽量避免过于激进的误报。

## 规则模型

规则分为三类：

- `strong-block`：直接命中结构性特征，立即拦截
- `contextual-block`：当类似密钥的上下文字段与可疑值同时出现时拦截
- `mask`：替换常见个人信息后继续转发

## 强拦截规则

即使没有上下文字段，只要命中这些规则也应直接拦截。

### 私钥标记

示例：

- `-----BEGIN PRIVATE KEY-----`
- `-----BEGIN RSA PRIVATE KEY-----`
- `-----BEGIN OPENSSH PRIVATE KEY-----`
- `-----BEGIN EC PRIVATE KEY-----`
- `-----BEGIN DSA PRIVATE KEY-----`

建议分类：

- `PRIVATE_KEY`

### 授权 Token

示例：

- `Bearer <token>`
- `Basic <base64>`

建议分类：

- `BEARER_TOKEN`
- `BASIC_AUTH`

### JWT

典型形态：

- 由 `.` 连接的三个类似 base64url 的片段

建议分类：

- `JWT`

### Cookie 或 Session 头内容

示例：

- `Cookie: session=...`
- `Set-Cookie: token=...`

建议分类：

- `COOKIE_HEADER`
- `SET_COOKIE_HEADER`

### 带凭证的数据库 URI

示例：

- `postgres://user:pass@host/db`
- `mysql://user:pass@host/db`
- `mongodb://user:pass@host/db`
- `redis://:pass@host:6379/0`

建议分类：

- `DB_URI`

### 云服务与第三方服务凭证标记

示例：

- `AKIA...`
- `ASIA...`
- `ghp_...`
- `github_pat_...`
- `xoxb-...`
- `xoxp-...`
- `AIza...`

建议分类：

- `AWS_ACCESS_KEY`
- `GITHUB_TOKEN`
- `SLACK_TOKEN`
- `GOOGLE_API_KEY`

在快速模式里，当置信度足够高时可以纳入这些规则，但代理不能只依赖厂商前缀来判断。

## 上下文拦截规则

这类规则是保护无固定前缀 API Key、Session 和随机凭证字符串的核心手段。

### 拦截条件

只有在以下两个条件同时成立时才拦截：

- 存在高风险上下文字段或附近关键字
- 对应值符合可疑 token 的形态特征

这样可以避免把普通文本里的所有长随机字符串都误判为敏感信息。

## 高风险上下文关键字

如果以下关键字出现在 JSON key、表单字段名、请求头名、查询参数名，或明显的赋值标签中，应把附近的值视为凭证敏感内容。

### 通用密钥类术语

- `key`
- `api_key`
- `apikey`
- `app_key`
- `access_key`
- `secret`
- `secret_key`
- `client_key`
- `client_secret`
- `consumer_key`
- `consumer_secret`
- `private_key`
- `public_key`

### Token 与 Session 术语

- `token`
- `access_token`
- `refresh_token`
- `id_token`
- `auth_token`
- `bearer_token`
- `session`
- `session_id`
- `sessionid`
- `sid`
- `ticket`

### 认证类术语

- `authorization`
- `auth`
- `credential`
- `credentials`
- `passwd`
- `password`
- `passphrase`
- `login_token`
- `signin_token`

### Cookie 与 Header 术语

- `cookie`
- `set-cookie`
- `x-api-key`
- `x-auth-token`
- `proxy-authorization`

### 服务账号与配置术语

- `service_account`
- `service-account`
- `account_key`
- `account_secret`
- `accessKey`
- `secretKey`
- `clientId`
- `clientSecret`

## 关键字说明

### 是否应包含 `key`？

应当包含，但不能把它作为单独出现时的直接拦截触发器。

原因：

- `key` 在普通文本和代码里都非常常见
- 仅凭这个词就拦截，会造成过多误报

推荐用法：

- 将 `key` 纳入上下文规则
- 只有当 `key` 充当字段名或赋值标签，且对应值看起来像密钥时才拦截

这些示例默认不应拦截：

- `press any key to continue`
- `object key sorting`
- `primary key design`

这些示例应被拦截：

- `key=abCDef1234567890XYZtoken`
- `"key": "mN8qT4sL0pX9zAaB7dEf"`
- `client key: F8aM2vK9qP0xR7wL3sYd`

### 是否应包含 `secret`？

应当包含。

`secret` 的指示性远强于 `key`，应被视为高置信度上下文信号。

### 是否应包含 `token`？

应当包含。

`token` 是最强的上下文词之一，应被视为高置信度上下文信号。

### 是否应包含 `session`？

应当包含。

`session`、`session_id` 和 `sessionid` 都应被视为高置信度上下文信号。

### 是否应包含 `password`？

应当包含。

虽然密码不一定是 API Key，但它依然属于敏感凭证，应该拦截。

## 可疑值形态规则

上下文拦截应使用以下值形态规则。

建议的初始启发式条件：

- 长度 `>= 20`
- 长度 `<= 200`
- 字符主要来自 `[A-Za-z0-9._=-]`
- 不含空格，或仅包含极少量空格
- 明显不像自然语言句子

可选的增强启发式条件：

- 同时包含大写和小写字母
- 包含数字
- 熵高于配置阈值

## 上下文解析范围

上下文规则应应用于：

- JSON 的键和值
- 表单字段名和值
- multipart 文本字段名和值
- 请求头名和值
- 查询参数名和值
- 常见赋值文本，例如 `token=...`、`secret: ...`、`api_key: ...`

## 脱敏规则

这类规则默认不应拦截，而应替换后继续转发。

### 常见 PII 类别

- `PHONE`
- `EMAIL`
- `ID_CARD`
- `BANK_CARD`

### 建议替换值

- `[PHONE]`
- `[EMAIL]`
- `[ID_CARD]`
- `[BANK_CARD]`

## 文件拦截规则

在快速模式中，不检查文件内容。

只检查元数据。

### 始终拦截的文件名和扩展名

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

### 可选拦截的压缩包和数据导出类型

- `.sql`
- `.db`
- `.sqlite`
- `.bak`
- `.zip`
- `.7z`
- `.rar`

## 优先级顺序

代理应按以下顺序评估规则：

1. 文件元数据拦截规则
2. 强拦截规则
3. 上下文拦截规则
4. 脱敏规则
5. 放行

这样可以更早退出，并获得更好的延迟表现。

## 误报防护

为了让快速模式足够实用，以下情况本身不应直接触发拦截：

- 自然语言中的 `key`
- 没有可疑值配对的 `token`
- 没有敏感上下文的长哈希值
- 没有敏感上下文的 UUID
- 没有敏感上下文的随机构建 ID

这些示例默认不应拦截：

- `primary key`
- `token bucket algorithm`
- `hash key partition`
- `request id: 8a3d2c1f-...`

## 建议的拦截类型标签

为了便于审计和响应输出，应使用稳定标签：

- `PRIVATE_KEY`
- `BEARER_TOKEN`
- `BASIC_AUTH`
- `JWT`
- `COOKIE_HEADER`
- `SET_COOKIE_HEADER`
- `DB_URI`
- `AWS_ACCESS_KEY`
- `GITHUB_TOKEN`
- `SLACK_TOKEN`
- `GOOGLE_API_KEY`
- `CONTEXTUAL_SECRET`
- `SENSITIVE_FILENAME`

## 建议的脱敏类型标签

- `PHONE`
- `EMAIL`
- `ID_CARD`
- `BANK_CARD`

## v1 范围边界

以下内容不在这个快速配置的范围内：

- 语义级姓名识别
- 地址识别
- OCR
- PDF 解析
- Office 文档解析
- 附件内容清洗
- 在缺乏上下文时拦截所有看起来随机的字符串
