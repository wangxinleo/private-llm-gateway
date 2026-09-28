# 探针证据：旧格式机制移除验证(2026-09-28)

方法:本地 `next dev`(PORT=8124, `UPSTREAM_URL=http://127.0.0.1:8901`, `DB_PATH=/tmp/plg-e2e/audit.sqlite`,
`PRIVACY_DEBUG_HEADERS=true`)+ 本地 mock 上游(node,捕获上游实际收到的请求体并回显)。
探针脚本在 `/tmp/plg-e2e/`(临时目录,已清理),不入库。

## 静态零命中(交付约束)

```
rg -n 'PRIVACY_MASK' src README.md README.zh-CN.md                     → 零命中
rg -n 'PRIVACY_MASK_FORMAT' . (exc node_modules/.trellis/.git)          → 零命中
rg -n 'PRIVACY_MASK' .trellis/spec/                                     → 零命中
rg -n 'PRIVACY_MASK' . --hidden (exc node_modules/.git/.trellis/.opencode/.qoder*/.agents/.next) → 零命中
```

## 官方门(ci.md)

- `npm ci` → exit 0
- `npm test` → 62 passed | 1 skipped (63 files);570 passed | 1 skipped (571 tests)
- `npm run build` → exit 0(Next standalone 产物正常)

另:tsc 错误集与 HEAD 基线逐字节一致(14 = 14,`diff` 全等)——本任务零新增类型错误;
基线 14 条均在与本任务无关的文件(admin-audit/content-encoding/forwarder-headers/route-compressed-response/streaming-client-cancel/upstream-error-trace)。

## 探针 1:PHONE 脱敏 + 通知样例 = 真实签发标签 + 回显还原

请求:`POST /v1/chat/completions`,body `{"model":"gpt-4","messages":[{"role":"user","content":"my phone is 13912345678"}]}`

上游可见载荷(逐字):

```
{"model":"gpt-4","messages":[{"role":"user","content":"my phone is {{PHONE_zzvtk}}"},{"role":"system","content":"[Privacy notice] Anonymized placeholders like {{PHONE_zzvtk}} were injected by a privacy proxy: never invent, guess, expand, rewrite, translate, or remove them; keep every placeholder exactly as-is where the original value belongs."}]}
```

- 不同标签数 = 1(`{{PHONE_zzvtk}}`);出现 2 次(消息体 1 + 通知样例 1)→ 通知样例 = 本次真实签发标签。
- 原值 `13912345678` 计数 = 0;`PRIVACY_MASK` 字面计数 = 0(无旧格式、无旧格式重打码)。

客户端响应(逐字,节选):`"content":"echo:\nuser:my phone is 13912345678\n..."` → 占位符全部还原为原值,无 `{{PHONE_` 残留。

响应头:`x-privacy-masked: true`、`x-privacy-mask-types: PHONE`(与既有行为一致)。

## 探针 2:入站旧 token 原样透传(§6 明示的已知代价)

请求:`{"model":"gpt-4","messages":[{"role":"user","content":"legacy token <<PRIVACY_MASK:CUSTOM_TERM>> and phone 13912345678"}]}`

上游可见载荷(逐字):

```
{"model":"gpt-4","messages":[{"role":"user","content":"legacy token <<PRIVACY_MASK:CUSTOM_TERM>> and phone {{PHONE_zzvtk}}"},{"role":"system","content":"[Privacy notice] Anonymized placeholders like {{PHONE_zzvtk}} were injected by a privacy proxy: never invent, guess, expand, rewrite, translate, or remove them; keep every placeholder exactly as-is where the original value belongs."}]}
```

- 入站旧 token 原样上行(不再触发重打码合成规则);PHONE 照常脱敏;通知样例仍为真实签发标签。
- 客户端回显:旧 token 原样返回客户端(无 registry 映射、不可还原);PHONE 已还原。
- 附注:`{{PHONE_zzvtk}}` 与探针 1 同值——HMAC 确定性派生,跨请求稳定(预期设计,利好 Prompt Cache)。

## 探针 3:text/plain 分支

请求:`POST`,content-type `text/plain`,body `my phone is 13912345678 (plain-text probe)`

上游可见载荷(逐字):

```
my phone is {{PHONE_zzvtk}} (plain-text probe)

[Privacy notice] Anonymized placeholders like {{PHONE_zzvtk}} were injected by a privacy proxy: ...
```

- 文本分支后缀式通知样例 = 真实签发标签;无旧格式。响应头同上。

## 结论

四项验证全绿:唯一掩码格式 `{{LABEL_suffix}}`、通知样例=真实签发标签、还原闭环逐字、调试头不变;
旧格式生产机制(semantic 之外的 explicit/legacy 分支)在 src 中已零存在,入站旧 token 行为按设计变为透传。
