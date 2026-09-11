# Update nav.rules Translation to Bypass Rules

## Goal

将导航栏 `nav.rules` 的翻译从"扫描规则"更新为"临时放行规则"，以准确反映该页面的实际功能。

## Problem

当前翻译不准确：
- 中文：`nav.rules: "扫描规则"`
- 英文：`nav.rules: "Scan Rules"`

但该页面实际功能是管理临时放行规则（Bypass Rules），用于：
- 配置时间窗口内跳过隐私扫描的规则
- 按路径前缀和模型名称匹配
- 临时允许特定请求直接转发

## Requirements

更新 `src/i18n/dict.ts` 中的翻译：
- 中文：`"nav.rules": "临时放行规则"`
- 英文：`"nav.rules": "Bypass Rules"`

## Acceptance Criteria

* [ ] 中文翻译更新为"临时放行规则"
* [ ] 英文翻译更新为"Bypass Rules"
* [ ] 导航栏显示正确的文案

## Out of Scope

* 不修改其他页面的文案（规则页面内部的文案已经正确）
* 不修改路由或组件名称

## Technical Notes

* 文件：`src/i18n/dict.ts`
* 行号：约第 3 行（中文）和对应的英文部分
