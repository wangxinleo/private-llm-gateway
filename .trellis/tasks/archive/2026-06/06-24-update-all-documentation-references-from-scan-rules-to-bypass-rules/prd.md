# Update Documentation References from Scan Rules to Bypass Rules

## Goal

将所有文档中关于"扫描规则"/"Scan Rules"的引用更新为"临时放行规则"/"Bypass Rules"，以保持文档与实际功能的一致性。

## Files to Update

### 1. `doc/frontend-design.md`
需要更新的地方：
- "为隐私代理构建内网管理界面，用于查看审计日志、**扫描规则**和运行时配置。"
- "/dashboard/rules → **扫描规则**（只读）"
- "## `/dashboard/rules` — **扫描规则**"
- "page.tsx ← **扫描规则**"
- "Admin API 可读写审计日志，但不涉及**扫描规则**和系统配置的修改"

### 2. `doc/privacy-mask-disambiguation-design.md`
- "当前 `maskTag` 在各**扫描规则**里内联定义，不利于统一升级。"

**注意：** 这里的"扫描规则"可能指的是隐私扫描的规则模式（pattern），而非 `/dashboard/rules` 页面。需要根据上下文判断是否需要修改。

## Requirements

1. 将 `doc/frontend-design.md` 中所有"扫描规则"改为"临时放行规则"
2. 将 `doc/frontend-design.md` 中的"（只读）"标记移除或更新为"（可编辑）"，因为现在的临时放行规则页面支持创建、编辑、删除
3. 检查 `doc/privacy-mask-disambiguation-design.md` 中的上下文，判断是否需要修改

## Acceptance Criteria

* [ ] `doc/frontend-design.md` 中所有"扫描规则"更新为"临时放行规则"
* [ ] 功能描述准确反映当前实际功能（可编辑，而非只读）
* [ ] `doc/privacy-mask-disambiguation-design.md` 根据上下文正确处理

## Technical Notes

* 主要修改文件：`doc/frontend-design.md`
* 需要上下文判断：`doc/privacy-mask-disambiguation-design.md`
