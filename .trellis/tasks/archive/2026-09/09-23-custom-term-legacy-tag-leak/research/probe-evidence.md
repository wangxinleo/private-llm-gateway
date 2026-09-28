# 探针证据：自定义词短码泄漏与通知旧格式（2026-09-23）

方法：临时 vitest 探针（DB 经 `vi.mock("@/config")` 隔离至 tmpdir；`MaskRegistry` 注入确定性后缀派生 `() => "bcdfg"`），
链路 = `maskJsonBody(runPipeline + registry)` → `applyDisambiguation`，捕获「上游实际可见载荷」。
探针已删除（`src/__tests__/zz-probe-custom-term.test.ts`），临时 DB 已清理，工作区干净。

## 用例 1：label="gffund"、value="gffund"（碰撞）

```
{"model":"probe","messages":[{"role":"user","content":"水印探针：{{GFFUND_bcdfg}} 与 {{EMAIL_trwmq}} 原样保留"},
"role":"system","content":"[Privacy notice] Anonymized placeholders like {{EMAIL_trwmq}} or <<PRIVACY_MASK:CUSTOM_TERM>> were injected by a privacy proxy: ..."}]
registry tags: {{GFFUND_bcdfg}}
含 "gffund" 字面? false  含 "GFFUND"? true
含旧格式 <<PRIVACY_MASK:? true
```

## 用例 2：label="CUSTOM"、value="gffund"（不碰撞）

```
{"model":"probe","messages":[{"role":"user","content":"水印探针：{{CUSTOM_bcdfg}} 与 {{EMAIL_trwmq}} 原样保留"}, ...]}
registry tags: {{CUSTOM_bcdfg}}
含 "gffund" 字面? false  含 "GFFUND"? false
含旧格式 <<PRIVACY_MASK:? true
```

## 结论

1. **H1 机制确证（条件性）**：label 与词条值碰撞时，短码把原词逐字带上游——`{{GFFUND_bcdfg}}`，模型可直接读出被过滤词；不碰撞时标签为 `{{CUSTOM_...}}`，无可推导泄漏。触发条件 = 词条 label（服务器实例实填值待查，见 prd「现象 1」）。
2. **D1 确证（与 label 无关）**：mask 生效且 CUSTOM_TERM 为首个命中类别时，通知必然以 `<<PRIVACY_MASK:CUSTOM_TERM>>` 示范旧格式——与用户上报 token 逐字一致；且用户水印中的 `{{EMAIL_trwmq}}` 亦为通知默认示例文本，两个非 gffund token 均可归因于通知。
3. 旧格式不可还原（restore.test.ts:40-44 设计如此）：模型回显后客户端侧必然出现 `<<PRIVACY_MASK:...>>` 字面。

## 后续结论（2026-09-23 用户复核）

- **现象①闭环为非缺陷**：用户复核确认 AI 并未获得原词，客户端所见 `gffund` 属还原协议的正确行为（"其实他根本不知道 gffund，是正确回填了，是我看得到罢了"）。本任务不修复①；上述条件性机制作为潜在面留存本文件。
- **现象②（D1）保留修复**：机制 + 观测 + 逐字 token 三重证据，独立于①。

## 本地端到端复核（2026-09-23，实施后）

方法：test DB 起 `next dev`（PORT=8124，UPSTREAM_URL=http://127.0.0.1:8901）+ 本地 mock 上游捕获原文；
探针体 `{"model":"gpt-4","messages":[{"role":"user","content":"my phone is 13912345678"}]}`（PHONE 为全文扫描类别；EMAIL 仅窗口锚点内命中属既有设计，不参与本复核）。

上游可见载荷（逐字）：

```
{"model":"gpt-4","messages":[{"role":"user","content":"my phone is {{PHONE_xkvmm}}"},{"role":"system","content":"[Privacy notice] Anonymized placeholders like {{PHONE_xkvmm}} or {{PHONE_xkvmm}} were injected by a privacy proxy: never invent, guess, expand, rewrite, translate, or remove them; keep every placeholder exactly as-is where the original value belongs."}]}
```

- `<<PRIVACY_MASK:` 计数 = 0；原值 `13912345678` 计数 = 0；通知样例 = 本次签发标签 `{{PHONE_xkvmm}}`（两处示例位同值）。
- 回显闭环：mock 把收到的标签回显进响应 → 客户端输出 `echo: 13912345678 13912345678 13912345678`（3 处标签全部还原，无残留字面）。
- 附注：实施前同链路通知样例为 `<<PRIVACY_MASK:PHONE>>`（旧格式），回显后不可还原——本次修复消除了该面。
