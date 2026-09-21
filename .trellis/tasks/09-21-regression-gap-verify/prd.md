# 补测：桌面回归未覆盖路径（multipart / 词库 UI 写 / reveal）

## Goal

补齐 F1 完整回归声明的边界路径（真实生产构建 + 真实链路），发现的问题就地修复并复验；无生产功能新增。

## Requirements（结果见 research/desktop-evidence.md）

- R1 multipart 上传链路：文本字段脱敏、文件字节完整、boundary 正确；敏感文件名阻断（403）。
- R2 自定义词 UI 写操作闭环：UI 新增 → 列表可见 → 真实请求命中脱敏。
- R3 reveal 揭示流程：错密码可见报错；正密码后 audit 返回 matchedValues。
- R4 边界声明：真实第三方上游（无凭据）与 multipart 文件内容（设计不扫描）明确记录。

## Acceptance Criteria

- [x] AC1 multipart 三例（C1/C2/C3）真实链路证据齐备。
- [x] AC2 自定义词 UI 写入 → 转发体占位符、零残留。
- [x] AC3 reveal 错/对密码两路行为正确（含 F-C1 修复与复验）。
- [x] AC4 截图 ×3 + 原始捕获记录归档；`npm test` 与 `build` 绿。
