# 审计日志路径筛选改为使用配置的路径前缀选项

## Goal

将审计日志页面的路径筛选下拉框改为读取配置的 `path_prefix_options`，而不是从审计记录中提取实际路径。

## What I already know

**当前实现：**
- 审计日志页面调用 `/api/admin/audit` API
- API 使用 `SELECT DISTINCT path FROM audit_log` 获取所有唯一路径
- 前端将这些路径填充到筛选下拉框

**配置系统：**
- `path_prefix_options` 已在系统配置中可在线编辑
- 配置存储在 `system_config` 表，可通过 `/api/admin/config` API 获取
- 当前值：`["/api/v1/messages", "/api/v1/responses", "/api/v1beta"]`

**涉及的文件：**
- `src/app/api/admin/audit/route.ts` - 审计日志 API
- `src/app/dashboard/audit/page.tsx` - 审计日志页面

## Requirements

1. 审计日志页面启动时从配置 API 读取 `path_prefix_options`
2. 将这些配置的路径前缀作为路径筛选下拉框的选项
3. 保留"全部路径"选项
4. 移除从审计记录中动态提取路径的逻辑

## Acceptance Criteria

- [ ] 审计日志页面加载时调用 `/api/admin/config` API
- [ ] 路径筛选下拉框显示配置的路径前缀选项
- [ ] 用户修改系统配置中的路径前缀后，刷新审计日志页面能看到新的筛选选项
- [ ] 筛选功能正常工作（选择某个路径前缀后只显示匹配的记录）
- [ ] 已有测试继续通过

## Definition of Done

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- Rollout/rollback considered if risky

## Out of Scope

- 不合并历史路径和配置路径（用户只能按配置的前缀筛选）
- 不需要后端 API 修改（`/api/admin/audit` 的 `paths` 字段可以移除）

## Technical Approach

1. 在 `audit/page.tsx` 中添加 `loadPathPrefixOptions()` 函数（类似 `rules/page.tsx`）
2. 在 `useEffect` 中调用此函数获取配置
3. 将 `pathPrefixOptions` state 用于筛选下拉框
4. 移除使用 `data.paths` 的逻辑

## Technical Notes

- 参考 `src/app/dashboard/rules/page.tsx:78-94` 的实现模式
- 审计日志 API 的 `paths` 字段可以保留（向后兼容），但前端不再使用
