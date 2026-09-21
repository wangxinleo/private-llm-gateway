# 补测：桌面回归未覆盖路径（multipart / 词库 UI 写 / reveal）

## Goal

补齐 F1 完整回归声明的边界路径（真实生产构建 + 真实链路），并对发现的问题就地修复后复验。

## 范围与结果

| # | 路径 | 方法 | 结果 |
|---|---|---|---|
| C1 | multipart 上传链路 | curl -F 文本字段(含手机号) + 文件 → mock 回显 base64 原样体 | ✅ 新 boundary 生成且与 body 一致；文本字段脱敏（`{{PHONE_...}}`、零残留）；文件内容逐字节完整 |
| C2 | multipart 敏感文件名 | `file=@.env` | ✅ 403 `blocked_by_privacy_proxy` / `blocked_types:["SENSITIVE_FILENAME"]` |
| C3 | multipart 文件内容边界 | 文件内容含手机号 | ✅ 按设计不扫描（原样透传）；文本字段不受影响 —— 已声明边界 |
| C4 | 自定义词 UI 写操作 | 无头 Edge CDP：登录 → 词库页表单新增（label=PROJECTX / value=AcmeVerifyWord）→ 列表出现 → 真实请求穿透 | ✅ 转发体 `{{PROJECTX_smwgr}}`、零残留（UI 写入即时生效） |
| C5 | reveal 揭示流程 | CDP：审计页点击揭示 → 错密码 → 正密码 | ✅ 错密码：对话框内可见报错（修复后，见 F-C1）；正密码：对话框关闭、`/api/admin/audit` 返回 `matchedValues:{"PHONE":["13800138000"]}` |

## 发现与修复（F-C1，已随本任务修复）

- **reveal 错密码静默失败**：`audit-table.tsx` 的 `revealError` 状态从未被设置、`audit.revealError` 文案从未渲染——输入错误密码点"确认揭示"后对话框毫无反馈（CDP 实测：无报错、无状态变化）。
- 修复：失败分支 `setRevealError(true)`；对话框渲染 `role=alert` 的错误提示；输入变更时清除；复验：错密码可见报错、正密码正常揭示。

## 明确保留的边界（未覆盖）

- **真实第三方上游**（OpenAI/Anthropic 等）：无凭据；协议形状由 mock 场景 + 536 测试覆盖。
- multipart 文件内容不做脱敏（设计边界，见上 C3）。

## 证据

- 截图：`/tmp/llm-verify/shot-c1-words-added.png`（UI 新增词条）、`shot-c2b-reveal-error.png`（错密码报错）、`shot-c3b-reveal-ok.png`（揭示生效）
- 原始捕获：multipart 头/边界/body（含/不含明文）、字段与文件断言输出、自定义词转发体、reveal 后 audit JSON（见上文表格）。
