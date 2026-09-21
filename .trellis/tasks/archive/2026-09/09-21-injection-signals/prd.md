# 实现：请求侧注入审计信号（3 族，audit-only）

## Goal

按评估结论（`archive/2026-09/09-21-eval-injection-signals`，go/窄范围）实现 3 个请求侧注入信号，只记录不阻断，severity ≥ MEDIUM（过默认 floor），并满足 1MB 上下文性能门槛。

## Requirements 与实现

- R1 3 族信号（`src/proxy/request-analysis.ts`）：
  - `injection_fake_system_turn` (MEDIUM)：协议控制字面量（`<|im_start|>` 系列 / `<<SYS>>` / `[INST]`）；触发条件 = 不同字面量 ≥2 个，或字面量 ±200 字符内有指令语（ignore/忽略/新指令…）。
  - `injection_credential_exfil` (HIGH)：凭据对象（`~/.ssh` / `id_rsa` / `.env`(非单词前界) / aws_* / private key / keystore / wallet / 私钥 / 钱包 / 助记词 / `.npmrc`）+ 外发动作 + 外部目标（URL/IP/邮箱/webhook 服务）**在 ±80 字符同现**。
  - `injection_prompt_exfil` (MEDIUM)：套取句式（system prompt/系统提示词/隐藏指令…）±200 字符内有编码标记（base64/rot13/编码…）。
- R2 FP 纪律：泛化句式不单独上报（只在客观载荷同现时并入对应族）；**排除**"encoded payload 绕过"族（评估裁定）；凭据对象刻意不含 `credentials`/`token` 泛化词。
- R3 detail 只含 `{kind, preview}`，preview = 4+***+4 打码、无完整原文。
- R4 挂接：主路径与 bypass 路径均在 `logAudit` 后用 `insertSignals(auditId, analyzeRequestInjection(bodyText))`；分析**未脱敏原文**（避免脱敏改变字面量）；内部 try/catch 绝不中断请求。
- R5 性能（硬门槛）：1MB 基准 + 桌面 1.5MB；模块级 ≤80ms（实测 0.63-1.69ms）。

## Acceptance Criteria（结果）

- [x] AC1 3 族正例命中、severity 正确（MEDIUM/HIGH/MEDIUM）。
- [x] AC2 反例零命中：单独字面量提及、缺三要素的凭据句、仅句式、普通 prompt/代码/日志。
- [x] AC3 仓库文本负例集 0 信号（排除"按设计枚举字面量"的检测器源码/基准/评估任务文档；README 的"敏感文件名清单+uploaded+URL"经同现窗收紧 200→80 后消除）。
- [x] AC4 性能：1MB 基准 clean=0.63ms / marked=1.69ms；桌面 1.5MB+标记耗时 57-67ms（与不含信号基线同量级），3 信号全部落库。
- [x] AC5 `npm test` 536 passed + `npm run build` 绿；spec 记录边界。

## Out of Scope

- 阻断式拦截；encoded payload 解码检测；响应侧信号改动。
