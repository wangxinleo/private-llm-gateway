# T3 验证证据:响应还原可观测性

## 1. 单测覆盖（新增/扩展）

| 文件 | 覆盖 |
|---|---|
| `src/__tests__/placeholder-scan.test.ts`（新, 7 用例） | 容忍形态矩阵（严格/缺括号/内空白/小写标签）、已知标签白名单、notice 豁免、samples ≤5 去重不泄明文 |
| `src/__tests__/restore.test.ts`（扩展） | `restored/degraded` 计数、加宽形态修复（`{{ PHONE_x }}`/`{{phone_x}}`）、未发行 token 原样保留、无双计 |
| `src/__tests__/restore-observability.test.ts`（新, 路由级 4 用例） | 非流式 3/2/1 计数+落库+`audit_update` 广播+信号同源；SSE 流尾落库；空 registry 四列 NULL；超限跳过四列 NULL |
| `src/__tests__/mask-tag.test.ts`（扩展） | `LOOSE_RX` 加宽后形态断言 + 空白邻接不被吞 |
| `src/__tests__/response-analysis.test.ts`（回归） | 共享检测器后 residual/notice 豁免不回归 |

## 2. 发现并修复的回归（单测捕获）

`LOOSE_RX` 首版加宽写成 `\{{0,2}\s?CORE\s?\}{0,2}`，`\s?` 在花括号缺席时也参与匹配：
`"and PHONE_trwmq"` 的分隔空格被并入 match，替换后吞空格（`"13912345678 and13912345678"`）。
`restore.test.ts` 既有断言当场失败 → 重写为「空白只随花括号消耗」的三分支形态
（带括号 / 悬空开括号 / 裸 token），裸 token 与悬空形态均不吞邻接空白，且保留
旧的括号不对称容忍（`{PHONE_x`、`{{PHONE_x}`、`{PHONE_x}}` 断言全绿）。

## 3. 真机 E2E（构建产物 + mock 上游 + 桌面浏览器）

环境: `next start -p 3100`（DB_PATH=/tmp/t3-verify.sqlite 隔离）, mock 上游 8787 回
`"{tag} + {{ {core} }} + {core} + PHONE_zzzzq"`（严格 + 内空白 + 裸形态 + 未发行 token）。

- **请求侧**：`POST /v1/chat/completions`（"我的手机 13800138000"）→ 响应
  `{"echo":"13800138000 + 13800138000 + 13800138000 + PHONE_zzzzq"}`（三形态全还原、未发行 token 原样）。
- **落库**：`SELECT id, action, restore_count, restore_degraded, restore_unresolved, restore_samples`
  → `1|mask|3|2|1|["PHONE_zzzzq"]`。
- **SSE 广播**（curl -N 抓 `/api/admin/audit/stream`）：
  ```
  event: audit
  data: {"id":2,...,"findings":["PHONE"],"action":"mask",...}
  event: audit_update
  data: {"id":2,"restoreCount":3,"restoreDegraded":2,"restoreUnresolved":1,"restoreSamples":["PHONE_zzzzq"]}
  ```
- **面板（zh）**：展开行显示「响应还原: 已还原 3 / 降级修复 2 / 未还原 1 / 残留样本 PHONE_zzzzq」，
  安全信号同屏 `response_poison·MEDIUM`；与列值一致。
- **实时合并（不刷新）**：页面保持打开（SSE 实时绿灯），另发一条请求 → 新行经
  `event: audit` 插入、四字段经 `event: audit_update` 按 id 合并后展开即见计数
  （`audit` 事件载荷本不含四字段，能显示即证明合并生效）。
- **面板（en）**：切 EN 后显示 Response Restore / Restored 3 / Degraded 2 / Unresolved 1 /
  Residual samples，无缺 key 回显；控制台无 error。

## 4. 回归面

`npm test` 565 passed | 1 skipped；`npm run build` 绿。
