# 桌面验证:输出占位符格式统一为 {{LABEL_suffix}} 单格式(2026-09-28)

目标:桌面级(真实 UI + 真实代理链路)确认全部输出面只存在唯一占位符格式 `{{LABEL_suffix}}`,
不存在 `<<PRIVACY_MASK:...>>` 或其它形式的第二种格式。

方法:本地栈 = mock 上游(node:8901,捕获真实上游可见载荷并回显)+ `next dev`(Turbopack:8124,
`UPSTREAM_URL=http://127.0.0.1:8901 DB_PATH=/tmp/plg-e2e/audit.sqlite ADMIN_KEY=... PRIVACY_DEBUG_HEADERS=true`);
浏览器 = Edge(CDP,新开独立标签页);UI 写操作走真实表单,揭示流程走真实对话框。

## D0 静态输出面侦察(代码侧)

- `rg PRIVACY_MASK` 全仓(排除 node_modules/.git/.trellis):**零命中**。
- `src/app/dashboard/**`、`src/i18n/dict.ts`:无任何占位符格式展示串(仅表单输入 placeholder,无关)。
- 唯一格式定义:`mask-tag.ts:91` `TAG_RE = /\{\{[A-Z][A-Z0-9_]*_[bcdfghjkmnpqrstvwxzBCDFGHJKMNPQRSTVWXZ]{5}\}\}/`。

## D1 词库 UI 写入(真实表单)

无头驱动 Edge → 登录(dashboard 管理员认证)→ 敏感词库页表单新增:分类 `PROJECTX`、词条 `AcmeVerifyWord`。
列表即时出现(`PROJECTX / AcmeVerifyWord / 词条 / 启用`);截图 `shot-d1-words-added.png`。

## D2 探针 1:PHONE + 自定义词(真实代理链路)

请求体(经 8124 代理转发至 mock 上游):

```
{"model":"gpt-4","messages":[{"role":"user","content":"my phone is 13912345678, her email is alice@example.com, project AcmeVerifyWord"}]}
```

上游实际可见载荷(逐字,mock 捕获):

```
{"model":"gpt-4","messages":[{"role":"user","content":"my phone is {{PHONE_mmkkw}}, her email is alice@example.com, project {{PROJECTX_cbgrb}}"},{"role":"system","content":"[Privacy notice] Anonymized placeholders like {{PHONE_mmkkw}} were injected by a privacy proxy: never invent, guess, expand, rewrite, translate, or remove them; keep every placeholder exactly as-is where the original value belongs."}]}
```

- 格式断言:`PRIVACY_MASK`=0、`<<`=0;全部 `{{...}}` 记号严格匹配 TAG_RE(零非严格记号);
  宽扫 `<<...>>`、`[CATEGORY]`、`REDACTED/MASKED/XXX/***` 均零命中。
- 通知样例 = **本次真实签发标签** `{{PHONE_mmkkw}}`(非静态示例、非旧格式)。
- 响应头:`x-privacy-masked: true`、`x-privacy-mask-types: PHONE,CUSTOM_TERM`。
- 客户端收到的响应(mock 回显经还原):`my phone is 13912345678, ... project AcmeVerifyWord`(原值回填,无残留)。

## D3 探针 2:仅自定义词(原缺陷触发形态)

请求体:`{"model":"gpt-4","messages":[{"role":"user","content":"project codename AcmeVerifyWord is confidential"}]}`

上游实际可见载荷:

```
{"model":"gpt-4","messages":[{"role":"user","content":"project codename {{PROJECTX_cbgrb}} is confidential"},{"role":"system","content":"[Privacy notice] Anonymized placeholders like {{PROJECTX_cbgrb}} were injected by a privacy proxy: ..."}]}
```

- CUSTOM_TERM 为首个(唯一)命中时,通知样例 = `{{PROJECTX_cbgrb}}`——原缺陷形态下曾出现 `<<PRIVACY_MASK:CUSTOM_TERM>>`,现已消除。
- `PRIVACY_MASK`=0、`<<`=0;记号全部严格匹配;同值跨请求后缀稳定(`cbgrb` 与探针 1 一致,HMAC 确定性)。
- 客户端收到:`echo: project codename AcmeVerifyWord is confidential | ... like AcmeVerifyWord ...`(含通知样例位全部还原)。

## D4 审计页(真实 UI)

- 两行记录 `/v1/chat/completions`(106 B CUSTOM_TERM 两次命中;138 B PHONE+CUSTOM_TERM)动作=脱敏;
  DOM 全文无 `PRIVACY_MASK`、无 `<<`;截图 `shot-d2-audit-list.png`。
- 审计 API 原始 JSON(`/api/admin/audit`,rsc 直读):`findings` 只含类别名(`["PHONE","CUSTOM_TERM"]`),
  `restoreCount/degraded/unresolved` 数值字段;零格式记号。

## D5 揭示流程(真实对话框)

1. 错密码 `wrong-password` → 对话框内 `role=alert` 可见报错"揭示失败:管理员密码不正确,或当前登录已过期。"(F-C1 修复回归通过);截图 `shot-d3-reveal-error.png`。
2. 输入变更 → 报错即时清除(修复的"输入变更清除"行为)。
3. 正密码 → 对话框关闭,工具栏变 `原始值可复制 [countdown]`。
4. 展开行详情(截图 `shot-d4-audit-detail-revealed.png`):
   - 命中详情:类别徽章;响应还原:已还原 2/3,降级修复 0,未还原 0;
   - 匹配原始值:`1391**5678`、`Acme**Word` —— UI 肩窥保护的部分掩码预览(复制按钮给真实值),非占位符格式;
   - DOM 全文零 `PRIVACY_MASK`/`<<`。
5. 揭示态下审计 API 的 `matchedValues` = 原始值(`13912345678`/`AcmeVerifyWord`),零格式记号。

## D6 CSV 导出(真实点击,下载重定向至 /tmp)

```
Time,Method,Path,Content-Type,Size,Model,Findings,Action,Bypass,Duration
2026-09-28T01:21:41.774Z,POST,"/v1/chat/completions",application/json,106,"gpt-4",CUSTOM_TERM,mask,no,20.68
...
```

`Findings` 只含类别名;CSV 全文 `PRIVACY_MASK`=0、`<<`=0、`{{`=0。

## D7 其余页面清扫

`/dashboard`(总览:请求 4/脱敏 2)、`/dashboard/settings`、`/dashboard/rules`、`/dashboard/clients`
服务端 HTML 全量扫描:`PRIVACY_MASK`=0、`<<`=0、`{{LABEL_xxxxx}}`=0。

## D8 探针 3:入站旧格式字面(边界,按设计)

客户端主动回放 `<<PRIVACY_MASK:EMAIL>>` 字面:

- 上游可见:`...replayed token <<PRIVACY_MASK:EMAIL>> plus phone {{PHONE_mmkkw}}...` —— 客户端数据**原样透传**(字面零存在决策:
  代理不做防御识别),而代理自身产出仍只有 `{{PHONE_mmkkw}}` 一种格式。
- 客户端收到的回显未还原(非本代理签发),但 `13912345678` 正常还原。

## 结论

PASS。代理全部自身输出面(上游转发体、通知文本、响应头、审计 UI/API、CSV、总览)只有一个占位符格式 `{{LABEL_suffix}}`;
零 `<<PRIVACY_MASK:...>>`、零其它变体。唯一可能出现旧格式字面的场景是客户端自带数据透传(非代理产出)。

## 明确保留/不覆盖

- 真实第三方上游(OpenAI/Anthropic 等):无凭据,协议形状由 mock + 单测覆盖(桌面栈用 mock 上游)。
- 流式(SSE)响应:还原协议共用同一实现;本轮用非流式响应驱动(与 09-21 批次一致)。
- EMAIL 正文窗口锚点设计未变(探针 1 中 `alice@example.com` 未被掩码属既有扫描窗口设计,与格式无关)。

## 截图清单

- `/tmp/llm-verify/shot-d1-words-added.png` — 词库 UI 新增词条
- `/tmp/llm-verify/shot-d2-audit-list.png` — 审计列表(两条脱敏记录)
- `/tmp/llm-verify/shot-d3-reveal-error.png` — 错密码对话框内报错
- `/tmp/llm-verify/shot-d4-audit-detail-revealed.png` — 揭示态展开详情(部分掩码预览 + 还原计数)

## 原始捕获清单

- `/tmp/plg-e2e/captured-3.txt` — 探针 1 上游可见载荷;`captured-4.txt` — 探针 2;`captured-5.txt` — 探针 3
- `/tmp/plg-e2e/probe{1,2,3}-headers.txt` / `-response.json` — 响应头与客户端响应
- `/tmp/plg-e2e/audit-api.json` — 审计 API(未揭示态);揭示态 matchedValues 见 D5
- `/tmp/plg-e2e/downloads/audit-log-2026-09-28.csv` — CSV 导出
