# Implement — 请求侧注入信号

## 步骤（已完成）

- [x] 1. `src/proxy/request-analysis.ts`：3 族检测 + 打码 preview + try/catch 不中断。
- [x] 2. `route.ts` 挂接：主路径 + bypass 路径（logAudit 后 insertSignals，分析未脱敏原文）。
- [x] 3. 测试 `injection-signals.test.ts` 7 用例（正例/反例/仓库负例集/detail 打码）。
- [x] 4. 基准 `benchmarks/injection-signals-1mb.test.ts`（1MB：clean 0.63ms / marked 1.69ms）。
- [x] 5. 全量 `npm test`（536 passed）+ `npm run build` 绿。
- [x] 6. 桌面验证：小请求 3 信号落库；1.58MB+标记 3 信号落库、duration 57-67ms。
- [x] 7. spec gotcha + 提交 + 归档。

## 关键取舍记录

- 同现窗：族 1/3 = ±200；族 2 收紧到 ±80（README"敏感文件名清单+uploaded+URL"实测误报驱动）。
- 负例排除清单（有理由）：检测器源码、内嵌标记的基准文件、按设计枚举检测字面量的评估任务文档。
