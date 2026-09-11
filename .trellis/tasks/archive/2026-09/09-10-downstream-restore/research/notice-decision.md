# 消歧提示词存废分析(还原时代)

> 背景:下行还原上线后,用户提出"既然可以还原,补充提示词是否可以删除,让模型自行原样回写占位符"。

## 结论:保留但重写(不删除)

现有默认文案(config.ts:55-63)= 解释性内容 + 处方性内容:

- **可删(解释性)**:"tokens replaced hidden content…"等背景说明,模型无需知道为什么。
- **必须保留(处方性)**:还原只能挽救"逐字回写"一种行为;以下失败态还原全部无能为力:

| 无提示词时模型行为 | 还原可补救 | 后果 |
|---|---|---|
| 逐字回写占位符 | ✅ | 正常还原 |
| 当模板变量自行填值 | ❌ 无 tag 可匹配 | **伪造值被当真值呈现(最危险)** |
| 散文改述/元评论 | ❌ | tag 丢失,输出怪异 |
| 代码重写时丢弃遮蔽区 | ❌ | 内容静默丢失 |

即:还原时代提示词的作用从"解释脱敏"升级为"抑制伪造填充与静默丢弃"——告诉模型"占位符就是真实值本身"恰恰**需要一句明确指令**才能从"通常回写"变为"稳定回写"。

## 活体证据

本任务会话自身运行于该网关之后,通知多次注入并实际引导了编码代理(本助手)的编辑行为(锚定可见文本、不整文件重写)。编码代理场景下处方性规则是 load-bearing 的实证。

## v2 新默认文案(重构定稿,≤80 tokens 以 tokenizer 校准)

```text
Placeholders like <<PRIVACY_MASK:EMAIL:1>> represent real values, transparently restored before the user sees your reply. Treat each placeholder as the original value: reproduce it verbatim; never invent or example-fill one; never drop or renumber placeholders when rewriting files. Anchor edits only to visible unmasked text, never line numbers after a placeholder; if unanchorable, output a Manual Modification Guide (file, location, change, reason).
```

- 含"将被透明还原"声明:给模型逐字复现提供语义理由(而非任意规则)。
- 保留 Manual Modification Guide 逃生门(编码代理场景核心安全阀)。
- 示例 tag 同步 v2 实例格式。

## 子任务执行记录

- 文案起草:派发 gemini-3.8-flash(ses_f75a38a9affedbTio02OsehoXQ);初派陷入长时探索(2×600s 超时),续推后由 cc-auto 兜底交付草稿(路由回落,已记录);终稿按代码主权重构。
- 行为分析:派发 grok-4.6(ses_f75a3a4afffeSSid4UOnuYyWPN);三轮均未交付正文(两次进度循环、一次空转),按代码主权由主会话收口,上表为最终分析。

## 最终裁决(D4,2026-09-10)

用户选择**彻底删除**,推翻本文件的"保留但重写"建议与 ≤80 tokens 新文案方案。伪造填充/静默丢弃风险已知悉接受,赌模型原生回写保真度。prd.md(R9/AC8/D4)、design.md(§2/§4)、implement.md(步骤 9)已按删除方案更新。若实测出现伪造填充或静默丢弃,可从 git 历史与本文件恢复处方性规则集。
