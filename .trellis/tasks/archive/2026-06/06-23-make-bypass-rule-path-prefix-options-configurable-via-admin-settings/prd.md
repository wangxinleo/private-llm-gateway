# Make system configurations hot-reloadable via admin settings

## Goal

将系统配置页面从只读改为可编辑，支持管理员在线修改配置并立即生效（热更新），无需重启服务。配置持久化到数据库，包括：
1. 临时放行规则的路径前缀选项列表
2. 其他适合热更新的系统配置（扫描阈值、上下文密钥规则等）

**排除不适合热更新的配置：** UPSTREAM_URL、DB_PATH、DEBUG、NODE_ENV、PORT（这些需要重启服务才能生效）

## What I already know

### 当前实现

**临时放行规则页面 (src/app/dashboard/rules/page.tsx):**
- Line 156-164: 路径前缀选项硬编码在前端

**系统配置页面 (src/app/dashboard/settings/page.tsx):**
- 只读页面，显示：
  - 环境变量：UPSTREAM_URL, DB_PATH, DEBUG, NODE_ENV, PORT（**不可热更新**）
  - 扫描阈值：FULL_SCAN, CHUNKED_SCAN, CHUNK_SIZE（**可热更新**）
  - 上下文密钥配置：MIN_LENGTH, MAX_LENGTH, MAX_SPACES（**可热更新**）
  - 数据库统计（只读）

**配置管理 (src/config.ts):**
- 所有配置通过环境变量或硬编码常量读取
- 无运行时可修改的配置机制

**配置 API (src/app/api/admin/config/route.ts):**
- 仅支持 GET 方法（只读）

### 决策：使用 SQLite 数据库表存储配置

**方案 A（已选定）：** 新建数据库表存储可热更新的配置
- 表名：`system_config`
- 字段：
  - `key` (TEXT PRIMARY KEY) - 配置键名
  - `value` (TEXT) - 配置值（JSON 格式）
  - `type` (TEXT) - 配置类型（number, string, json_array）
  - `description` (TEXT) - 配置说明
  - `updatedAt` (TEXT) - 最后更新时间

**优点：**
- 与现有审计日志数据库共用，无额外依赖
- 支持事务，数据安全
- 可扩展（未来可添加版本控制、变更历史）

## Requirements

### 1. 数据库设计

**新建表：`system_config`**
- 存储可热更新的配置项
- 支持不同类型的值（数字、字符串、JSON 数组）

**初始数据（默认值）：**
- `path_prefix_options`: `["/api/v1/messages", "/api/v1/responses", "/api/v1beta"]`
- `size_threshold_full_scan`: `131072` (128KB)
- `size_threshold_chunked_scan`: `1048576` (1MB)
- `chunk_size`: `65536` (64KB)
- `context_key_min_length`: `8`
- `context_key_max_length`: `200`
- `context_key_max_spaces`: `2`

### 2. 配置加载机制

**优先级：** 数据库配置 > 环境变量 > 硬编码默认值

**启动时：**
- 从数据库加载配置到内存
- 如果数据库为空，使用硬编码默认值并写入数据库

**运行时：**
- 配置更新后立即生效（更新内存中的配置对象）
- 无需重启服务

### 3. API 设计

**GET /api/admin/config**
- 返回所有配置（包括只读和可编辑）
- 增加字段标识哪些配置可编辑

**PUT /api/admin/config**
- 更新可热更新的配置
- 请求体：`{ key: string, value: any }`
- 验证配置值的合法性
- 更新数据库并刷新内存配置

### 4. 系统配置页面改造

**UI 变更：**
- 只读配置（环境变量）：保持现有只读展示
- 可编辑配置：增加"编辑"按钮，点击后弹出编辑对话框
- 路径前缀配置：支持增删改，显示为列表

**交互流程：**
1. 点击"编辑"按钮
2. 弹出对话框，显示当前值
3. 修改后提交
4. 调用 API 保存
5. 成功后刷新页面显示

### 5. 临时放行规则页面改造

**变更：**
- 从 API 动态加载路径前缀选项（不再硬编码）
- 如果 API 返回空列表，显示提示信息引导用户到系统配置页面设置

## Assumptions (temporary)

- 数据库迁移可以在应用启动时自动执行
- 配置更新频率不高，无需考虑并发冲突
- 配置值验证在后端进行

## Open Questions

### 1. 路径前缀配置的 UI 设计

**方案 C（已选定）：内联编辑**
- 在系统配置页面新增一个 Card：「路径前缀配置」
- 直接显示所有路径前缀，每行一个
- 每个路径旁边有删除图标（X 按钮）
- 底部有输入框 + "添加"按钮，可以直接添加新路径
- 实时生效（添加/删除后立即调用 API 保存）

**交互流程：**
1. 添加：在底部输入框输入路径 → 点击"添加"按钮 → 调用 API → 成功后刷新列表
2. 删除：点击路径旁的 X 图标 → 调用 API → 成功后刷新列表

### 2. 其他配置项的编辑方式

**选项 1（已选定）：内联编辑**
- 每个配置项右侧显示当前值
- 点击值后变为输入框，可以直接修改
- 失焦或按 Enter 后保存（调用 API）
- 如果验证失败，显示错误提示并恢复原值

**应用于：**
- 扫描阈值：`size_threshold_full_scan`, `size_threshold_chunked_scan`
- 分块大小：`chunk_size`
- 上下文密钥：`context_key_min_length`, `context_key_max_length`, `context_key_max_spaces`

## What I Decided (User Confirmation)

### 存储方案
- ✅ 使用 SQLite 数据库表 `system_config` 存储配置

### 热更新配置范围
- ✅ 路径前缀选项列表
- ✅ 扫描阈值（FULL_SCAN, CHUNKED_SCAN）
- ✅ 分块大小（CHUNK_SIZE）
- ✅ 上下文密钥规则（MIN_LENGTH, MAX_LENGTH, MAX_SPACES）
- ❌ 不包括：UPSTREAM_URL, DB_PATH, DEBUG, NODE_ENV, PORT（需重启才能生效）

### UI 设计
- ✅ 路径前缀：内联编辑（直接显示列表，支持添加/删除）
- ✅ 数值配置：内联编辑（点击值变为输入框）

### API 设计
- ✅ 方案 A：统一的 `PUT /api/admin/config` 接口
- ✅ 请求体：`{ key: string, value: any }`
- ✅ 路径前缀添加/删除时，前端维护完整列表，整体提交

## Technical Approach

### 实现步骤

**Step 1: 数据库迁移**
1. 在 `src/audit.ts` 中添加 `system_config` 表创建逻辑
2. 添加配置读写函数：`getConfig`, `setConfig`, `getAllConfigs`
3. 应用启动时初始化默认配置

**Step 2: 配置加载机制改造**
1. 修改 `src/config.ts`，增加从数据库加载配置的逻辑
2. 优先级：数据库 > 环境变量 > 硬编码默认值
3. 提供配置刷新函数（配置更新后调用）

**Step 3: API 实现**
1. 修改 `GET /api/admin/config`：增加 `editable` 字段标识可编辑配置
2. 新增 `PUT /api/admin/config`：支持更新配置，验证值合法性
3. 更新后刷新内存配置

**Step 4: 系统配置页面改造**
1. 新增「路径前缀配置」Card
2. 路径列表展示 + 添加/删除交互
3. 数值配置改为可编辑（点击变输入框）
4. 错误处理与加载状态

**Step 5: 临时放行规则页面改造**
1. 从 API 动态加载路径前缀选项
2. 处理空列表情况（显示提示）

**Step 6: 国际化文本**
1. 新增配置编辑相关的国际化键

## Acceptance Criteria

* [ ] 数据库表 `system_config` 已创建
* [ ] 数据库初始化时写入默认配置
* [ ] 配置加载机制：数据库 > 环境变量 > 硬编码默认值
* [ ] GET /api/admin/config 返回所有配置，标识可编辑字段
* [ ] PUT /api/admin/config 支持更新单个配置项
* [ ] 配置更新后立即生效（刷新内存中的配置对象）
* [ ] 系统配置页面：路径前缀支持内联添加/删除
* [ ] 系统配置页面：数值配置支持点击编辑
* [ ] 临时放行规则页面：从 API 动态加载路径前缀选项
* [ ] 配置值验证：数值范围、路径格式等
* [ ] 国际化文本已更新
* [ ] 错误处理：API 失败时显示友好提示

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope

* 配置变更历史记录（未来功能）
* 配置版本回滚（未来功能）
* 配置导入/导出功能
* 拖拽排序路径前缀
* 为路径前缀添加描述字段
* 修改不可热更新的配置（UPSTREAM_URL, DB_PATH 等）

## Technical Notes

### 相关文件
- `src/config.ts` - 当前配置管理
- `src/app/api/admin/config/route.ts` - 配置 API
- `src/app/dashboard/settings/page.tsx` - 系统配置页面
- `src/app/dashboard/rules/page.tsx` - 临时放行规则页面
- `src/audit.ts` - 数据库操作（需要添加 system_config 表操作）

### 数据库表设计

```sql
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('number', 'string', 'json_array')),
  description TEXT,
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 配置键名约定

- 使用 snake_case 命名
- 前缀规则：
  - `path_prefix_*` - 路径相关
  - `size_threshold_*` - 大小阈值
  - `context_key_*` - 上下文密钥规则

### 技术栈
- React 18 + TypeScript
- Next.js 15 (App Router)
- SQLite 数据库
- shadcn/ui 组件库
- Tailwind CSS