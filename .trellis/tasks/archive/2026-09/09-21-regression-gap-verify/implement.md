# Implement — 桌面回归补测

## 步骤（已完成）

- [x] 1. mock 增强：raw body 按 Buffer 捕获（multipart 二进制安全）+ 回显 content-type。
- [x] 2. C1/C2/C3 multipart 三例实测（脱敏/阻断/文件边界）。
- [x] 3. C4 词库 UI 写操作（无头 Edge CDP）→ 列表可见 → 请求穿透脱敏。
- [x] 4. C5 reveal：发现 F-C1（错密码静默失败）→ 修复 `audit-table.tsx` → 复验两路。
- [x] 5. 证据归档 `research/desktop-evidence.md` + 截图 ×3。
- [ ] 6. 提交 + 归档。
