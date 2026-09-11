# Fix Dashboard Recent Incidents Display

## Goal

修复 Dashboard 首页"最近拦截记录"功能，使其能够显示实际的安全事件记录，而不是永远显示"暂无拦截记录"。

## Problem

当前 Dashboard 页面的"最近拦截记录"只查询 `action='block'` 的记录，但实际业务场景中：
- `block` 类型：完全拦截请求
- `mask` 类型：发现敏感信息并脱敏处理
- `allow` 类型：正常放行

用户数据库中有大量 `mask` 记录（4条）和 `allow` 记录（1条），但没有 `block` 记录，导致"最近拦截记录"永远为空。

从安全监控角度，`mask` 类型的记录同样重要（表示发现了敏感信息），应该在"最近拦截记录"中展示。

## Requirements

### 1. 修改查询逻辑
- 并行查询 `block` 和 `mask` 两种类型的记录
- 合并结果并按时间倒序排序
- 最多显示 10 条记录

### 2. 保持现有界面
- 标题保持"最近拦截记录"（中文）/ "Recent Incidents"（英文）
- 不需要修改文案，因为 mask 也是一种需要关注的安全事件

### 3. 视觉区分
- 确保现有的 Badge 样式能够区分 `block` 和 `mask`
- `block` - 红色 badge (destructive)
- `mask` - 黄色/橙色 badge (warning)

## Acceptance Criteria

* [ ] Dashboard 能够显示 `action='mask'` 的记录
* [ ] Dashboard 能够显示 `action='block'` 的记录
* [ ] 只显示 `block` 和 `mask`，不显示 `allow`
* [ ] 记录按 ID 降序排序（最新的在前）
* [ ] 最多显示 10 条记录
* [ ] Badge 样式能够区分 block 和 mask
* [ ] 使用真实数据库测试（`./data/audit.sqlite`）能正常显示 mask 记录

## Technical Approach

**方案 A：前端并行查询两次然后合并**

修改 `src/components/dashboard-content.tsx:55` 的逻辑：
1. 并行发送两个请求：
   - `/api/admin/audit?limit=5&action=block`
   - `/api/admin/audit?limit=5&action=mask`
2. 合并两个结果数组
3. 按 timestamp 或 id 降序排序
4. 取前 10 条记录

优点：
- 不需要修改 API 代码
- 实现简单快速
- 两个请求并行执行，性能影响小

实现细节：
- 使用 `Promise.all()` 并行请求
- 合并后按 `id` 降序排序（id 是自增的，天然按时间排序）
- 限制最终显示数量为 10 条

## Out of Scope

* 不修改审计日志完整列表页面的筛选逻辑
* 不修改统计数据的计算逻辑

## Technical Notes

* 关键文件：`src/components/dashboard-content.tsx:55`
* API 端点：`src/app/api/admin/audit/route.ts`
* 查询函数：`src/audit/store.ts` 的 `queryAudit()`
