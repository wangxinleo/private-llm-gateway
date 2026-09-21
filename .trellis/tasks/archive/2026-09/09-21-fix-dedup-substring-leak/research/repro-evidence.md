# F1 复现证据（2026-09-21 桌面验证，生产构建 + 真实链路）

环境：`node .next/standalone/server.js`（:3210，`UPSTREAM_URL=http://127.0.0.1:8787`，IPV6_PRIVATE 经管理面开启）→ mock 上游 `/scenario/echo` 回显请求体 base64。

## 例 1：IPv6（T5 触发）

请求（节选）：`节点 fe80::1 与带zone fe80::1%eth0`

上游实际收到（base64 解码）：

```json
{"model":"gpt-4o-mini","messages":[{"role":"user","content":"节点 fe80::1 与带zone {{IPV6PRIV_mqrbg}}"}, ...]}
```

审计记录（`GET /api/admin/audit`）：

```json
{"action":"mask","findings":["IPV6_PRIVATE","IPV6_PRIVATE","IPV6_PRIVATE"],"maskCount":3}
```

文本中有 4 处私网地址出现（fe80::1 / Fe80::1 / fe80::1%eth0 / fd00::5），只有 3 条 finding → 第一处独立出现漏脱。

## 例 2：既有规则同病（PHONE + Luhn 卡号）

构造：`卡号 1380013800000003 与手机 13800138000`（`1380013800000003` Luhn 有效，且包含手机号字面量）

上游实际收到：

```json
{"model":"gpt-4o-mini","messages":[{"role":"user","content":"卡号 {{BANK_CARD_jmqck}} 与手机 13800138000"}, ...]}
```

审计仅记 `BANK_CARD`（PHONE finding 因 `"1380013800000003".includes("13800138000")` 被吸收丢弃）→ 手机号**明文上行**。

## 结论

- 缺陷位于 `src/scanner/context-window.ts` `push()` 的按值子串吸收（位置盲），与 09-21 批次新增的 IPV6_PRIVATE 规则无关，既有规则可独立触发。
- 缺陷类别：masking 路径上的静默明文泄漏（审计显示"已脱敏"，实际未脱敏）。
- 桌面复验截图与网关日志：`/tmp/llm-verify/shot-4-audit.png`、`/tmp/llm-verify/gateway.log`（一次性验证环境，未入库）。
