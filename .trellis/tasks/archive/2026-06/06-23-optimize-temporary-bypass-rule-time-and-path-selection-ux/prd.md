# Optimize temporary bypass rule time and path selection UX

## Goal

优化临时放行规则功能的时间选择和路径选择交互体验，将难用的手动输入改为易用的选择器，参考审计日志的设计模式。

## What I already know

### 当前实现 (src/app/dashboard/rules/page.tsx)

**时间选择问题：**
- Line 174-186: 使用 `<Input type="datetime-local">` 组件
- 要求用户手动输入日期和时间，体验差
- 默认值为空字符串，用户需要从零开始输入

**路径选择问题：**
- Line 158-162: 使用 `<Input>` 文本框
- 用户需要手动输入路径前缀（如 `/v1/chat`）
- 没有预设选项，容易输入错误

**审计日志的参考设计 (src/components/audit-table.tsx):**
- Line 175-180: 路径筛选使用 `<select>` 下拉选择器 + 预设选项
- Line 182-189: 时间范围使用 `<select>` + 预设时间段选项（今天、近3天、本周等）

## Requirements

### 时间选择优化

1. **选择器类型：** 使用下拉选择器 `<select>` 选择预设时间窗口
2. **预设时间窗口选项：**
   - 4 小时（从现在开始）
   - 8 小时（从现在开始）
   - 1 天（从现在开始）
3. **逻辑：**
   - 开始时间 = 当前时间（创建时刻）
   - 结束时间 = 当前时间 + 选择的时长
   - 用户选择时长，系统自动计算开始和结束时间
4. **默认值：** 4 小时

### 路径选择优化

1. **选择器类型：** 使用下拉选择器 `<select>` 代替文本输入框
2. **预设选项（复用审计日志路径列表，去掉"全部路径"）：**
   - `/api/v1/messages`
   - `/api/v1/responses`
   - `/api/v1beta`
3. **默认值：** `/api/v1/messages`
4. **不支持自定义输入**

## What I Decided (User Confirmation)

### 时间选择方案
- ✅ 使用 `<select>` 下拉选择器，提供预设时间窗口选项（4小时/8小时/1天）
- ✅ 用户选择时长，系统自动计算 startAt 和 endAt
- ✅ 默认值：4 小时

### 路径选择方案
- ✅ 使用 `<select>` 下拉选择器
- ✅ 复用审计日志的路径列表（去掉"全部路径"选项）
- ✅ 3 个预设路径：`/api/v1/messages`, `/api/v1/responses`, `/api/v1beta`
- ✅ 默认值：`/api/v1/messages`
- ✅ 暂不支持自定义路径输入

## Acceptance Criteria

* [ ] 时间窗口选择改为下拉选择器 `<select>`，提供 4小时/8小时/1天 三个预设选项
* [ ] 默认选中 4 小时
* [ ] 用户选择时长后，系统自动计算 startAt（当前时间）和 endAt（当前时间+时长）
* [ ] 路径选择改为下拉选择器 `<select>`
* [ ] 路径选择器包含预设的常用路径选项
* [ ] UI 样式与审计日志页面保持一致
* [ ] 创建规则的交互流畅，无明显卡顿
* [ ] 现有功能不受影响（模型名输入、备注输入、启用开关等）
* [ ] 国际化文本已更新（中文/英文）

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope

* 修改后端 API 逻辑（后端仍接收 ISO 格式的 startAt/endAt）
* 增加时间重复规则（每天/每周）
* 路径模式的正则表达式支持
* 规则的编辑功能（当前仅支持创建、启用/禁用、删除）
* 自定义路径输入（将来可能支持）
* 自定义时间窗口（将来可能支持）

## Technical Notes

### 相关文件
- `src/app/dashboard/rules/page.tsx` (line 174-186: 时间输入, line 158-162: 路径输入)
- `src/components/audit-table.tsx` (line 175-180: 路径选择参考, line 182-189: 时间范围参考)
- `src/i18n/dict.ts` (line 78-106: 临时放行规则的国际化文本)

### 技术栈
- React 18 + TypeScript
- Next.js 15 (App Router)
- shadcn/ui 组件库
- Tailwind CSS

### 约束
- 必须保持国际化支持（中文/英文）
- 需要保持与现有 shadcn/ui 组件风格一致
- 不能破坏现有的表单验证逻辑

## Technical Approach

### 实现变更概览

**时间选择改造：**
1. 删除两个 `<Input type="datetime-local">` 字段
2. 新增一个 `<select>` 时间窗口选择器
3. 表单状态从 `{ startAt: string, endAt: string }` 改为 `{ duration: number }` (单位：小时)
4. 提交时计算：
   - `startAt = new Date().toISOString()`
   - `endAt = new Date(Date.now() + duration * 3600000).toISOString()`

**路径选择改造：**
1. 将 `<Input>` 改为 `<select>`
2. 硬编码 3 个路径选项
3. 默认值从 `"/v1/chat"` 改为 `"/api/v1/messages"`

**国际化新增键：**
- `rules.bypassDuration`: "时间窗口" / "Time window"
- `rules.bypassDuration4h`: "4 小时" / "4 hours"
- `rules.bypassDuration8h`: "8 小时" / "8 hours"
- `rules.bypassDuration1d`: "1 天" / "1 day"

### 实现步骤

**Step 1: 更新国际化文本 (src/i18n/dict.ts)**
- 添加时间窗口相关的 4 个新键

**Step 2: 修改表单组件 (src/app/dashboard/rules/page.tsx)**
- 修改 `RuleFormState` 接口：移除 `startAt/endAt`，添加 `duration`
- 修改 `EMPTY_FORM` 默认值
- 修改表单 UI：两个时间输入框 → 一个时间窗口下拉框
- 修改路径输入框 → 路径下拉框
- 修改 `handleCreate` 提交逻辑，计算 startAt/endAt

**Step 3: 验证与测试**
- 手动测试创建规则功能
- 验证生成的 ISO 时间格式正确
- 验证国际化切换正常
