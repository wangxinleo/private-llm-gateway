# Fix Incorrect Default Path Prefix Configuration

## Goal

修复路径前缀配置的默认值错误。当前默认值包含 `/api` 前缀（如 `/api/v1/messages`），但实际审计日志记录的路径是去掉 `/api` 后的路径（如 `/v1/messages`），导致临时放行规则无法匹配和审计日志筛选失败。

## What I Already Know

* `src/app/api/[[...path]]/route.ts:21` 的 `extractPath()` 函数会移除请求路径开头的 `/api` 前缀
* 实际记录到审计日志的路径格式：`/v1/messages`、`/v1/responses` 等（不含 `/api`）
* 当前默认配置（`src/config.ts:13`）：`["/api/v1/messages", "/api/v1/responses", "/api/v1beta"]`
* 临时放行规则匹配逻辑（`src/bypass/rules.ts:38`）：`if (!input.path.startsWith(rule.pathPrefix))`
* 路径前缀配置用于：
  1. 临时放行规则创建时的下拉选项
  2. 审计日志的路径筛选选项
* 配置支持热更新，存储在数据库中

## Impact

**当前问题：**
1. 用户使用默认配置创建的临时放行规则永远不会匹配（`/api/v1/messages` 无法匹配实际路径 `/v1/messages`）
2. 审计日志的路径筛选无法正常工作（筛选条件与数据不匹配）

## Requirements

* 修正 `src/config.ts` 中的默认配置，移除 `/api` 前缀
* 正确的默认值应为：`["/v1/messages", "/v1/responses", "/v1beta"]`
* 修正测试文件 `src/__tests__/admin-config-stats.test.ts` 中的 mock 数据

## Acceptance Criteria

* [ ] `DEFAULT_CONFIG_VALUES.PATH_PREFIX_OPTIONS` 使用正确的路径格式（不含 `/api`）
* [ ] 测试文件中的 mock 数据使用正确的路径格式
* [ ] 新建的临时放行规则能正确匹配请求路径
* [ ] 审计日志的路径筛选能正确工作
* [ ] 现有测试全部通过

## Definition of Done

* 代码修改完成
* 相关测试通过
* 考虑数据迁移方案（如果需要）

## Decision

**用户选择：方案 1 - 仅修复代码默认值**

* 修正 `src/config.ts` 中的默认配置
* 修正测试文件中的 mock 数据
* 不自动迁移数据库中已有的配置值
* 用户需要在设置页面手动更新已保存的错误配置（如有）

理由：简单、安全、不会影响用户可能的自定义配置

## Out of Scope

* 自动迁移数据库中已有的错误配置值
* 在管理界面添加配置格式验证提示（可作为未来改进）

## Technical Notes

* 关键文件：
  - `src/config.ts:13` - 默认配置定义
  - `src/__tests__/admin-config-stats.test.ts:44,104` - 测试 mock 数据
  - `src/app/api/[[...path]]/route.ts:19-22` - 路径提取逻辑（移除 `/api` 前缀）
  - `src/bypass/rules.ts:38` - 规则匹配逻辑
