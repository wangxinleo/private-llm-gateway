# PRD: 前端重构 — 借鉴 Maskit 设计语言

## 背景与目标

参考 [Data Maskit](https://github.com/xiaYuTian11/maskit) 的控制台设计体系，摒弃本项目现有的"暗色玻璃拟态"前端，重构为干净、克制、亮色优先的企业级管理界面。**功能与 API 保持不变，仅重塑视觉与交互框架。**

## 设计基调 (Design Read)

内部工具型管理控制台（gateway admin console），受众为开发者/运维。语言：Maskit 式干净实用风 — 亮色优先 shadcn token、蓝 primary、白卡片 + slate-50 底、细边框 + 低饱和阴影。

Dials: VARIANCE 3 / MOTION 2 / DENSITY 6（trust-first 工具界面，克制优先）。

## 借鉴 Maskit 的核心设计决策

1. **Token 体系**：HSL shadcn 变量。亮色 `:root`（slate-50 底 + 白卡 + 蓝 primary `224 76% 48%`）+ 暗色 `[data-theme='dark']`（去饱和中性深灰，饱和度压到 8-14%）。radius 0.75rem。卡片双色值阴影（rest/hover）。
2. **布局骨架**：可折叠左侧栏（展开 w-56 / 折叠 52px，Logo + 导航 + 折叠按钮）+ h-14 毛玻璃顶栏（`bg-background/70 backdrop-blur-md`：状态点 + 页面标题 + 主题/语言切换）+ 内容区 `max-w-[1200px] p-6`。
3. **主题切换**：`data-theme` 属性 + localStorage 持久化，默认跟随 `prefers-color-scheme`。亮暗双模式全覆盖。
4. **字体**：Inter（sans）+ JetBrains Mono（等宽）本地自托管（OFL 许可，woff2 variable），中文回落系统字体。基准 14px。数字 `tabular-nums`。
5. **导航激活态**：`from-primary/15 to-primary/5` 渐变底 + 左侧 3px 指示条。
6. **状态指示点**：顶栏运行状态点（emerald/amber/red + 微光晕），替换现有语义。
7. **i18n 持久化**：语言选择写入 localStorage（现有实现刷新即丢失）。

## 功能范围（全部保留，不新增后端）

- 登录门（admin key → sessionStorage）
- 概览页：4 统计卡 + 近期事件列表
- 审计页：筛选、SSE 实时流、批量删除、按过滤清理、CSV 导出、明文揭示（reveal）、行展开详情、分页
- 规则页：Bypass 规则增删/启停/重新激活
- 设置页：路径前缀、环境变量、Context Key 参数、Context Window、高风险资产 JSON、DB 统计
- 中英 i18n

## 非目标

- 不改动 `src/app/api/**`、`src/scanner/**`、`src/proxy/**`、`src/audit/**`（另一在途任务正在修改，严禁触碰）
- 不引入 react-query/zustand 等新依赖（保持现有 fetch 模式）
- 不复制 Maskit 代码（AGPL），仅借鉴设计令牌与交互模式，全部代码重写

## 验收标准

1. 亮/暗双模式完整可用，切换持久化，默认跟随系统
2. 侧栏可折叠且持久化，移动端收敛为顶部横条
3. 全部 5 个页面 + 登录门在双模式下视觉一致、无对比度问题（WCAG AA）
4. 审计页全部既有功能回归通过（SSE、筛选、删除、导出、揭示）
5. `npm run build` 与 `npm run test` 通过
6. 无 Inter 之外的第三方字体请求（自托管 woff2）
