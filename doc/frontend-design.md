# 前端管理页设计（Frontend Admin Panel Design）v1

## 目的

为隐私代理构建内网管理界面，用于查看审计日志、扫描规则和运行时配置。

v1 范围：只读展示 + 审计日志实时刷新 + 日志批量删除。不做在线规则编辑、不做图表、不做认证。

## 前置依赖

当前项目无任何前端基础设施（零 UI 库、零 CSS 框架、零管理 API），需同时补建后端 Admin API 和前端页面。

## 页面结构

```
/dashboard              → 总览
/dashboard/audit        → 审计日志（核心页面）
/dashboard/rules        → 扫描规则（只读）
/dashboard/settings     → 系统配置（只读）
```

## `/dashboard` — 总览

数值卡片，纯服务端渲染，无图表。

| 卡片 | 数据 | SQL |
|------|------|-----|
| 总请求数 | 全部审计记录 | `SELECT COUNT(*) FROM audit_log` |
| 拦截数 | action=block | `SELECT COUNT(*) FROM audit_log WHERE action='block'` |
| 脱敏数 | action=mask | `SELECT COUNT(*) FROM audit_log WHERE action='mask'` |
| 放行数 | action=allow | `SELECT COUNT(*) FROM audit_log WHERE action='allow'` |

底部展示最近 10 条拦截记录（action != allow），点击跳转审计日志页。

## `/dashboard/audit` — 审计日志

最常用页面。支持筛选、分页、实时刷新、详情展开。

### 数据源

`audit_log` 表结构：

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | 自增主键 |
| timestamp | TEXT | ISO 8601 |
| path | TEXT | 请求路径 |
| method | TEXT | HTTP 方法 |
| content_type | TEXT | Content-Type |
| body_size | INTEGER | 字节 |
| filenames | TEXT | JSON 数组 |
| findings | TEXT | JSON 数组，FindingCategory 列表 |
| action | TEXT | allow / mask / block |

### 表格列

☑️ | 时间 | 方法 | 路径 | 类型 | 大小 | 命中类别 | 动作

首列为复选框，用于批量选择。点击行体（非复选框区域）展开/收起详情。

### 筛选器

| 筛选项 | 类型 | 说明 |
|--------|------|------|
| action | 下拉单选 | allow / mask / block / 全部 |
| findings | 多选标签 | FindingCategory 枚举（16 种） |
| method | 下拉单选 | GET / POST / PUT / PATCH / DELETE |
| path | 文本输入 | 模糊匹配 |
| 时间范围 | 起止选择器 | 默认最近 24h |

### 分页

服务端分页，每页 50 条。URL 参数：`?page=1&action=block&findings=JWT&method=POST&q=/chat`。

### 详情展开收起

点击行体区域（非复选框列）展开该行详情面板，再次点击收起。同一时间可展开多行。

展开面板内嵌在行下方，显示：

- findings 完整列表（解析 JSON 数组，每个条目显示分类 + 动作）
- filenames 列表（解析 JSON 数组）
- content_type 原始值
- body_size 格式化显示（KB / MB）
- 单条删除按钮（仅在该行展开时可见）

### 批量选择与删除

| 操作 | 触发 | 行为 |
|------|------|------|
| 勾选单行 | 点击行首复选框 | 该行加入选中集 |
| 全选/全不选 | 表头复选框 | 当前页全部选中/取消 |
| 批量删除 | 表格上方工具栏按钮 | 删除所有选中行，确认弹窗提示数量 |
| 单条删除 | 展开详情面板内按钮 | 删除该条，确认弹窗 |
| 清除选择 | 工具栏链接 | 清空选中集 |

批量删除弹窗内容：「确定删除选中的 N 条记录？此操作不可撤销。」

### 一键清理

表格上方工具栏提供预设清理按钮：

| 按钮 | 逻辑 | 确认提示 |
|------|------|---------|
| 清理 30 天前放行记录 | `DELETE FROM audit_log WHERE action='allow' AND timestamp < now - 30d` | 将删除 30 天前的所有放行记录，预计 N 条 |
| 清理 7 天前放行记录 | `DELETE FROM audit_log WHERE action='allow' AND timestamp < now - 7d` | 将删除 7 天前的所有放行记录，预计 N 条 |
| 自定义清理 | 弹窗选择：时间范围 + 动作类型（allow/mask/block） | 将删除满足条件的记录，预计 N 条 |

一键清理按钮旁显示预估影响条数（通过 `SELECT COUNT(*)` 预查），执行后刷新列表。

### 实时刷新

使用 EventSource 连接 SSE 端点。新审计记录写入时，服务端推送事件，前端追加到列表顶部。

### 导出

当前筛选条件下的 CSV 导出。

## `/dashboard/rules` — 扫描规则

只读展示，反映代码中硬编码的规则。数据来源于 `src/scanner/*.ts`，在构建时静态提取。

### 凭证强规则

来源：`src/scanner/secrets.ts` → STRONG_RULES

| 分类 | 说明 |
|------|------|
| PRIVATE_KEY | PEM 私钥头 |
| BEARER_TOKEN | Bearer 前缀 |
| BASIC_AUTH | Basic 前缀 |
| JWT | 三段式 base64url |
| COOKIE_HEADER | Cookie 头 |
| SET_COOKIE_HEADER | Set-Cookie 头 |
| DB_URI | 带密码的数据库连接串 |
| AWS_ACCESS_KEY | AKIA/ASIA 前缀 |
| GITHUB_TOKEN | ghp_/github_pat_ 前缀 |
| SLACK_TOKEN | xoxb-/xoxp- 前缀 |
| GOOGLE_API_KEY | AIza 前缀 |

命中动作：mask（脱敏替换为标签后转发）。

### 上下文密钥规则

来源：`src/scanner/context-key.ts` → HIGH_RISK_KEYWORDS

64 个高风险关键字，列举 5 类：
- 通用密钥：key, api_key, apikey, secret, ...
- Token/Session：token, access_token, session, ...
- 认证：authorization, password, credentials, ...
- Cookie/Header：cookie, x-api-key, proxy-authorization, ...
- 服务账号：service_account, clientId, clientSecret, ...

值形态约束（来源 `src/config.ts` → CONTEXT_KEY）：
- 长度 8–200
- 字符集 `[A-Za-z0-9._=-]`
- 最多 2 个空格

命中动作：mask → `[CONTEXTUAL_SECRET]`。

### PII 脱敏规则

来源：`src/scanner/pii.ts` → PII_RULES

| 分类 | 替换标签 | 验证 |
|------|---------|------|
| PHONE | `[PHONE]` | 中国大陆手机号正则 |
| EMAIL | `[EMAIL]` | 标准邮箱正则 |
| ID_CARD | `[ID_CARD]` | 18 位身份证号 |
| BANK_CARD | `[BANK_CARD]` | 16-19 位 + Luhn 校验 |

命中动作：mask（替换后转发）。

### 文件名拦截规则

来源：`src/scanner/filename.ts`

阻止扩展名：.env, .pem, .key, .p12, .pfx, .npmrc, .pypirc

阻止文件名：id_rsa, id_dsa, authorized_keys, known_hosts, credentials.json, service-account.json, secrets.yaml, secrets.yml, prod.env, config.prod

命中动作：block（整个请求被拦截，返回 403）。

### 动作策略说明

| 场景 | 动作 | 由谁决定 |
|------|------|---------|
| 文件名命中 | block | `isBlockCategory()` → SENSITIVE_FILENAME |
| 凭证/PII 命中 | mask | 扫描器返回 `action: "mask"` |
| 无命中 | allow | pipeline 默认 |

## `/dashboard/settings` — 系统配置

只读展示当前运行时配置。

### 环境变量

| 变量 | 说明 | 示例值 |
|------|------|--------|
| UPSTREAM_URL | 上游服务地址 | http://upstream-service:8787 |
| DB_PATH | 审计库路径 | /data/audit.sqlite |
| DEBUG | 调试模式 | false |
| NODE_ENV | 运行环境 | production |
| PORT | 监听端口 | 3000 |

### 硬编码常量

来源：`src/config.ts`

| 常量 | 值 | 说明 |
|------|-----|------|
| FULL_SCAN | 128 KB | 低于此值完整扫描 |
| CHUNKED_SCAN | 1 MB | 低于此值分块扫描 |
| CHUNK_SIZE | 64 KB | 分块大小 |
| CONTEXT_KEY.MIN_LENGTH | 8 | 上下文密钥最小长度 |
| CONTEXT_KEY.MAX_LENGTH | 200 | 上下文密钥最大长度 |
| CONTEXT_KEY.MAX_SPACES | 2 | 可疑值最大空格数 |

### 数据库统计

| 指标 | SQL |
|------|-----|
| 审计记录总数 | `SELECT COUNT(*) FROM audit_log` |
| 最早记录时间 | `SELECT MIN(timestamp) FROM audit_log` |
| 最近记录时间 | `SELECT MAX(timestamp) FROM audit_log` |
| 数据库文件大小 | 文件系统 `stat` |

## 后端 Admin API

### `GET /api/admin/stats`

返回总览数据。

```json
{
  "total": 12345,
  "blocked": 42,
  "masked": 187,
  "allowed": 12116
}
```

无参数。

### `GET /api/admin/audit`

分页查询审计日志。

参数：

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| page | int | 1 | 页码 |
| limit | int | 50 | 每页条数（上限 200） |
| action | string | — | allow/mask/block |
| finding | string | — | FindingCategory |
| method | string | — | HTTP 方法 |
| q | string | — | 路径模糊搜索 |
| from | string | — | 起始时间 ISO 8601 |
| to | string | — | 截止时间 ISO 8601 |

响应：

```json
{
  "rows": [
    {
      "id": 101,
      "timestamp": "2025-06-16T08:30:00.000Z",
      "path": "/v1/chat/completions",
      "method": "POST",
      "contentType": "application/json",
      "bodySize": 2048,
      "filenames": [],
      "findings": ["JWT", "PHONE"],
      "action": "mask"
    }
  ],
  "total": 12345,
  "page": 1,
  "limit": 50
}
```

### `DELETE /api/admin/audit`

删除审计日志。支持按 ID 列表删除和按条件批量删除。

请求体（JSON）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ids | int[] | ids 和 filter 二选一 | 指定删除的记录 ID 列表 |
| filter | object | ids 和 filter 二选一 | 按条件批量删除 |
| filter.before | string | 是 | 删除此时间之前的记录（ISO 8601） |
| filter.action | string | 否 | 限定动作类型 allow/mask/block，不传则匹配所有 |

按 ID 删除示例：

```json
{
  "ids": [101, 102, 103]
}
```

按条件批量删除示例（删除 30 天前的放行记录）：

```json
{
  "filter": {
    "before": "2025-05-17T00:00:00.000Z",
    "action": "allow"
  }
}
```

响应：

```json
{
  "deleted": 42
}
```

预估影响条数（不实际删除）使用查询参数 `?dryRun=true`：

```json
{
  "wouldDelete": 42
}
```

校验规则：
- `ids` 和 `filter` 必须且只能传一个
- `ids` 数组上限 1000 条
- `filter.before` 必填，防止误删全表
- `ids` 为空数组或 `filter.before` 无效时返回 400

### `GET /api/admin/audit/stream`

SSE 实时推送。新审计记录写入后推送事件。

事件格式：

```
event: audit
data: {"id":102,"timestamp":"...","path":"...","method":"POST","contentType":"application/json","bodySize":512,"filenames":[],"findings":["BEARER_TOKEN"],"action":"block"}
```

实现方式：SQLite WAL 模式下，写入后通过回调触发推送。维护一个 `Set<ServerResponse>` 连接池。

### `GET /api/admin/config`

返回运行时配置（脱敏，不暴露上游 API key 等敏感字段）。

```json
{
  "env": {
    "upstreamUrl": "http://upstream-service:8787",
    "dbPath": "/data/audit.sqlite",
    "debug": false,
    "nodeEnv": "production",
    "port": 3000
  },
  "constants": {
    "sizeThresholds": { "fullScan": 131072, "chunkedScan": 1048576 },
    "chunkSize": 65536,
    "contextKey": { "minLength": 8, "maxLength": 200, "maxSpaces": 2 }
  },
  "dbStats": {
    "totalRecords": 12345,
    "earliestRecord": "2025-06-01T00:00:00.000Z",
    "latestRecord": "2025-06-16T08:30:00.000Z",
    "dbFileSize": 10485760
  }
}
```

## 技术选型

| 项目 | 选择 | 理由 |
|------|------|------|
| 组件库 | shadcn/ui | 按需安装、无运行时依赖、Next.js 原生兼容 |
| 样式 | Tailwind CSS v4 | shadcn/ui 前提、生产包体积小 |
| 数据获取 | Server Components + fetch | App Router 原生方案 |
| 实时刷新 | EventSource（SSE） | 原生 API、轻量、单向后推送 |
| 导出 | 前端 CSV 生成 | 无需后端额外端点 |
| 图表 | 无 | v1 不需要 |

不引入：MUI、Ant Design、recharts、WebSocket。

## 文件结构

```
src/
  app/
    dashboard/
      layout.tsx            ← 侧栏导航布局
      page.tsx              ← 总览
      audit/
        page.tsx            ← 审计日志
      rules/
        page.tsx            ← 扫描规则
      settings/
        page.tsx            ← 系统配置
    api/
      admin/
        stats/route.ts        ← GET /api/admin/stats
        audit/route.ts         ← GET+DELETE /api/admin/audit
        audit/stream/route.ts  ← GET /api/admin/audit/stream (SSE)
        config/route.ts        ← GET /api/admin/config
  components/
    ui/                       ← shadcn/ui 组件
    audit-table.tsx           ← 审计日志表格（含复选框、展开行）
    audit-filters.tsx         ← 筛选器
    audit-detail.tsx          ← 行展开详情面板
    audit-toolbar.tsx         ← 批量操作 + 一键清理工具栏
    audit-clean-dialog.tsx    ← 自定义清理弹窗
    stat-card.tsx             ← 数值卡片
    nav-sidebar.tsx           ← 侧栏导航
  lib/
    audit-query.ts            ← 审计查询 SQL 构建
    audit-delete.ts           ← 审计删除 SQL 构建 + dryRun
```

## 安全边界

- 内网部署，无认证
- Admin API 可读写审计日志，但不涉及扫描规则和系统配置的修改
- `DELETE /api/admin/audit` 强制要求 `ids`（上限 1000）或 `filter`（`before` 必填），防止误删全表
- 一键清理执行前必须展示预估影响条数，用户二次确认后才实际删除
- `/api/admin/config` 不暴露上游服务的 API key 或凭证
- 审计日志不记录原始密钥值和脱敏前的 PII 原文（与代理日志策略一致）
- SSE 连接不推送原始 matched 字段内容

## v1 不做的事

- 在线规则编辑
- 图表
- 认证/授权
- 多用户/权限
- WebSocket 双向通信
- 配置热更新
