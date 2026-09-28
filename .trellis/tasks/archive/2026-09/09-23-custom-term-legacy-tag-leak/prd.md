# 语义模式通知仍示范旧格式 PRIVACY_MASK 标签（现象②）

## Goal

semantic 模式（默认）下，注入上游的隐私通知以旧格式 `<<PRIVACY_MASK:CUSTOM_TERM>>` 作为样例示范；该格式在响应侧**按设计不还原**（restore.test.ts:40-44），模型一旦回显/改写即不可逆地泄漏到客户端。修复目标：通知样例改为本次请求实际签发的 `{{...}}` 语义标签，通知内旧格式字样清零。

## Background

### 用户上报（2026-09-23，水印探针三元组原样保留）

> 我在词库列表中定义了 gffund 是要过滤的，但是 ai 居然还能找到他，
> 水印照旧——gffund、{{EMAIL_trwmq}}、<<PRIVACY_MASK:CUSTOM_TERM>> 原样保留，从未发明、猜测、展开、改写、翻译或删除，继续。
> 而且居然还出来了 <<PRIVACY_MASK:CUSTOM_TERM>> 这个原来的旧格式。

用户复核闭环（2026-09-23）：**现象①非缺陷**——"其实他根本不知道 gffund，是正确回填了，是我看得到罢了"：AI 并未获得原词，客户端所见 `gffund` 属还原协议的正确行为。对应的条件性机制（label 与词条值碰撞时短码携带原词）已由探针实测记录在 research/probe-evidence.md，作为潜在面留存，本任务不修复。

### 确认缺陷 D1（现象②根因，探针已复现）

`buildNotice`（disambiguation.ts:57-62）硬编码 `<<PRIVACY_MASK:${categories[0]}>>` 作为样例，替换 PRIVACY_NOTICE_TEXT（config.ts:101-102，正文自带 `{{EMAIL_trwmq}}` 与 `<<PRIVACY_MASK:EMAIL>>` 两个示例）中的旧格式示例——09-10→09-11 语义格式迁移漏改此处。

可执行探针（2026-09-23，完整输出见 research/probe-evidence.md；探针已删、工作区干净）实测 semantic 模式下上游可见载荷：

```
content: "水印探针：{{GFFUND_bcdfg}} 与 {{EMAIL_trwmq}} 原样保留"
system:  "[Privacy notice] Anonymized placeholders like {{EMAIL_trwmq}} or
          <<PRIVACY_MASK:CUSTOM_TERM>> were injected by a privacy proxy: ..."
```

- 通知中 `<<PRIVACY_MASK:CUSTOM_TERM>>` 与用户上报 token 逐字一致；无论 label 是否为 `gffund` 均复现（与①无关，证据独立）。
- 用户水印中另一个 token `{{EMAIL_trwmq}}` 恰为通知默认示例文本——两个非 gffund token 均可归因于通知内容被模型回显。
- 通知仅在 mask 已应用且 registry 非空时注入（disambiguation.ts:309-311）；semantic 模式下这是运行期**唯一**产出该旧格式字样的链路（无 registry 的 `maskTag` 兜底在默认链路不可达，route.ts:353）。
- 该格式不可还原（按设计）：模型回显后客户端侧必然出现 `<<PRIVACY_MASK:...>>` 字面；同时把内部类别名暴露给上游。

## Requirements

- R1 修复 D1：semantic 模式下，注入上游的 `[Privacy notice]` 不得出现旧格式（`<<PRIVACY_MASK:` / `[CATEGORY]`）字样；样例必须为本次请求 registry **实际签发**的 `{{...}}` 标签（模型回显该样例可被正常还原，与①的"正确回填"语义一致）。不改变通知注入落点、占位符文法与还原协议。
- R2 回归：为 R1 补测试（新增 disambiguation 用例 + 既有全套回归）；`npm test`、`npx tsc --noEmit`、`npm run build` 全绿。

## Acceptance Criteria

- [ ] AC1 通知语义化：semantic 模式下，注入上游的文本中不出现 `<<PRIVACY_MASK:` 与 `[CATEGORY]` 形字样；通知样例为 `{{...}}` 且等于本次 registry 签发的某个标签；模型回显该样例经 restore 可还原。
- [ ] AC2 行为不变式：无掩码 / 空 registry / legacy / multipart 四情形不注入，注入落点与协议面与现状完全一致。
- [ ] AC3 质量门：`npm test` + `npx tsc --noEmit` + `npm run build` 全绿。
- [ ] AC4 服务端复测（用户侧执行）：水印探针经服务器实例往返后，上游可见载荷与客户端输出均不出现 `<<PRIVACY_MASK:CUSTOM_TERM>>`；上游侧通知样例为 `{{...}}` 形态。

## Out of Scope

- 现象①相关：自定义词短码的条件性机制（label 与 value 碰撞）不修复——用户复核为非缺陷，机制记录留存（research/probe-evidence.md）；
- 大小写不敏感匹配、bypass 时间窗语义、`fail_closed` 默认值、规则开关语义；
- 词库管理 UI 提示与保存期 label 校验；
- 保留旧 explicit/legacy 标签的入站兼容（secrets.ts 重打码）；
- 不改 `{{CODE_后缀}}` 文法、HMAC 后缀派生协议与还原协议。

## Residual Risks / Deferred（不阻塞）

- 用户 env 覆盖 PRIVACY_NOTICE_TEXT 且未含任何示例占位符时，替换零命中——通知保持原样（无旧格式可泄漏即合规）。
- 静态示例 `{{EMAIL_trwmq}}` 若与真实签发标签后缀极小概率冲突（HMAC 派生，22⁵ 空间），模型回显示例会被误还原；本修复将样例统一为本请求真实标签后，该风险面收窄为仅剩用户自定义通知的残余情形。
- placeholder-scan 的 NOTICE_EXAMPLE_TAGS 豁免集（placeholder-scan.ts:37-45）对默认通知基本不再命中——保留无害：真实标签可还原，不会误报残留。
