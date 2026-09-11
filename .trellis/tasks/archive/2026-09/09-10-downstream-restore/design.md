# 技术设计:下行无感还原

## 架构总览

```
请求侧(已有,小改)                    响应侧(新增)
scan → findings ─┐                    upstream SSE ──→ StreamRestorer(增量) ──→ client
                 ├→ MaskRegistry       upstream JSON ─→ restoreText(单遍) ────→ client
mask: applyMasks │   (tag→value)       
     分配实例tag ─┘                    还原仅在 registry 非空时激活;审计(logAudit)先于转发,
                                       还原天然位于审计之后的响应边界。
```

## 1. MaskRegistry(每请求映射表,新增 `src/scanner/mask-registry.ts`)

- `tagFor(category, value): string` — 键 `category\0value` 值级去重;产出 `{{SHORTCODE_SUF5}}`:后缀 = 密码学随机 5 位纯辅音(字符集 bcdfghjkmnpqrstvwxz,19^5≈248 万),冲突时请求内重掷探查,保证占位符 ↔ 原文严格双射(PRD-R8)。**随机而非哈希派生**:确定性后缀构成上游猜测-验证 Oracle,且 hex 形态诱导模型算术变造(maskit 生产实证,见 research/maskit-reference.md)。
- 防套娃(maskit 借鉴):tagFor 前若 value 自身命中占位符文法,严禁二次包裹——反查映射还原真值,查不到原样返回(PRD-R11)。
- 类别短码白名单(FindingCategory → CODE,≤12 字符,集中于 mask-tag.ts):PHONE / EMAIL / ID_CARD / BANK_CARD / CONNSTR / API_KEY / PRIVATE_KEY / SECRET / PRIVATE_IP 等;类别名不进入还原查找键之外的双重暴露面。
- `tagToValue: ReadonlyMap<string,string>` — 还原侧唯一查找结构。
- `size === 0` 时下游全部旁路,零开销。
- 生命周期:handleRequest 内创建,随响应闭包释放;无跨请求状态,并发请求天然隔离(PRD-D3)。

## 2. 脱敏侧改造(最小侵入)

- `buildMaskTag`(mask-tag.ts)保持产出模板 tag;**实例 tag 在应用时分配**:
  - `applyMasks(text, findings, registry?)` — 按 `(category, matched)` 经 `registry.tagFor` 生成最终 tag 再 replaceAll;返回 registry。
  - json-mask.ts:55 内联 replaceAll 收敛为调用 applyMasks(消除重复逻辑)。
  - `runPipeline` 增加 registry 参数透传;`rebuildMaskedMultipart`(route.ts:56)共享同一 registry(multipart 多字段同值同 tag)。
- `PRIVACY_MASK_FORMAT`:`semantic`(新默认,`explicit` 作别名兼容)产出 {{CODE_SUF5}};legacy 保持 `[CATEGORY]` 且不启用还原(歧义不可还原,PRD-R7)。
- applyMasks 叠加替换时按占位符正则切段,仅替换非占位符片段——防自定义词表字符劈开既有占位符造成永久还原失败(maskit 借鉴)。
- 消歧提示词改为极简保真指令(D4 v3 重裁):disambiguation.ts 注入管线**保留**;`PRIVACY_NOTICE_TEXT` 默认值替换为一行指令(禁止展开/伪造/改写/删除占位符,文案无原文);`PRIVACY_DISAMBIGUATION_MODE` 收敛为 auto|off(默认 auto,旧值 prefix/json-meta 解析为 auto 兼容);注入门控 = registry 非空且 mode=auto。不新增环境变量。

## 3. 还原引擎(新增 `src/proxy/restore.ts`)

### 3.1 非流式

```ts
restoreText(text, registry) // TAG_RE 单遍 replace:tag → tagToValue.get(tag) ?? tag
```

- TAG_RE 同时匹配 v3 `{{CODE_SUF5}}`、旧 explicit `<<PRIVACY_MASK:CAT[:N]>>` 与 legacy `[CATEGORY]`(只读查表,未命中→透传);宽松修复 RX(花括号 0-2 个可缺省,PRD-R12)仅查映射表命中才替换,degraded 单独计数。
- tag 全 ASCII、无 JSON 转义字符,原文级替换对 JSON 字符串值安全(含 tool arguments)。
- 响应体需缓冲读取(非流式本就完整);还原后删除 content-length,二进制 content-type(image/* 等)旁路。

### 3.2 SSE 流式(事件层通道化增量还原)

> 原文层方案缺陷(maskit 实证修正):占位符被上游切成两个 delta 事件时,原文层两半之间隔着 `"}}]}\n\ndata:"`,文法断裂→两半各自原样吐出→最常见的切分场景反而还原不了。还原必须下沉到 SSE 事件层、按 JSON 路径分通道缓冲。

```ts
SseChannelRestorer {
  pushBytes(chunk)              // TextDecoder{stream:true} 解码 → 文本累积 → \n\n 帧拆分(半帧尾部留置)
  restoreFrame(frame): string   // 非 data 帧/注释/[DONE] 原样透传;data 帧 JSON.parse 失败→透传;
                                //   成功→深度遍历字符串叶子,按 JSON 路径通道增量还原,重组帧返回
  flush(): string               // 流结束:各通道 pending 残留 → 克隆最后帧模板补发一个 delta(maskit flush_tmpl)
}
// 通道状态 = { pending }:同通道文本流跨帧拼接,hold-back ≤ 最长 tag 长度
```

- 通道 = JSON 叶子路径(choices.0.delta.content、tool_calls.0.function.arguments 等);深遍历天然覆盖 OpenAI/Responses/Anthropic/Gemini 全部增量事件形态;累计型重发 API 由"完整重发"天然兜底。
- 单通道匹配逻辑不变:双锚点(`{{`/`<<`)+ 受限文法([A-Z] 开头、[A-Z0-9_]* 中段、`_` + 5 位纯辅音收尾),单遍线性,无灾难回溯(regex-performance-guide);假前缀失配立即顺序释放(AC2)。
- 跨事件拼接:同通道 pending 跨帧保持——事件1 尾 `{{PHO` 与事件2 头 `NE_TRWMQ}}` 在同通道文本流中拼接还原(R3/AC2);通道间互相隔离,半截占位符不跨字段错位拼接(maskit 教训)。
- 重组帧 = 变更字符串后 JSON.stringify:JSON 语义不变、仅字节形态可能重排(客户端按 JSON 解析,无感);restorer 缺席时维持现状字节透传,零开销。
- 畸形帧(JSON.parse 失败)、`event:`/注释行原样透传,永不阻断流。
- 多字节 UTF-8:先 TextDecoder{stream:true} 解码再拆帧,悬切序列由 decoder 保持;tag 纯 ASCII。
- `createStreamingResponse(upstream, restorer?)`(streaming.ts 扩展):有 restorer 则走 字节→拆帧→通道化还原→重组帧 路径,否则维持现状字节透传。

## 4. route.ts 接线

- registry 创建于 handleRequest 顶部,贯通 bypass 扫描、正常扫描、multipart 重建。
- 响应分支:`registry.size > 0` 且 content-type 为 SSE/JSON/文本 → 走还原;否则原样(bypass 路径 registry 恒空,行为不变)。
- 上游 4xx/5xx 错误体同样走还原(错误体可能回显 tag)。
- forwardBody 构造保留 `applyDisambiguation`(route.ts:232),内部改为极简指令注入(门控:mode=auto 且 registry 非空;文案无原文,满足 R10)。

## 5. 兼容与迁移

- 无状态、无迁移:占位符不落盘,旧格式只在映射缺席时透传。
- 无新增环境变量:`PRIVACY_DISAMBIGUATION_MODE=off` 即等效旧"零注入"决策,秒级回退;还原由 registry 非空自动门控;回滚 = revert 提交。
- 受影响既有断言:mask-tag/mask/json-mask/streaming/disambiguation/e2e 测试样例更新为语义格式;disambiguation 断言改为一行指令门控。

## 6. 风险与对策(源自 grok 评审,已重构)

| 风险 | 等级 | 对策 |
|------|------|------|
| tag 跨 chunk/事件切分 | 高 | 事件层通道化还原 + 跨帧 pending + flush 补发(§3.2) |
| 同值跨类别歧义 | 中 | 注册表键含 category;窗口扫描 longer-match 已收敛包含关系 |
| 超大请求映射膨胀 | 中 | 值级去重;每请求生命周期;不持久化 |
| 模型改写/损坏 tag | 低 | 未命中透传,永不阻断流 |
| 伪造 tag 洪泛 | 低 | 单遍线性匹配,受限文法 |
| hold-back 引入延迟 | 低 | 仅悬挂前缀 ≤21 字符延迟,打字机无感 |
| 语义 token 诱导模板填充 | 中 | 极简保真指令注入(D4 v3)+ 未命中透传兜底(AC3) |
| 用户模板 {{...}} 撞形 | 中 | 受限文法 + 映射未命中透传;扫描期保留字登记(R11) |
| 十六进制后缀算术变造 | 中(maskit 生产 0.41%) | 纯辅音随机后缀,无数值可读性;未签发 token 绝不猜测(R8/AC3) |
| 模型剥落花括号 | 中(maskit 生产实测) | R12 宽松修复查表兜底,degraded 计数可观测(AC10) |
| JSON 重组帧改变字节形态 | 低 | 语义无损 stringify,客户端按 JSON 解析;restorer 缺席零改变 |

## 7. 测试策略

- 单元:mask-registry(去重/随机后缀冲突重掷/跨请求隔离)、restoreText(v3/旧 explicit/legacy/未命中/宽松修复 degraded)、SseChannelRestorer(单字节切分、跨事件切分、假前缀、EOF flush 补发、多字节悬切、相邻 tag、洪泛、畸形帧透传、通道间隔离)。
- 集成:e2e 脱敏→上游回显→还原 roundtrip(SSE + JSON,含 tool_calls 字段);上游零泄漏断言(mock 上游捕获载荷,原文计数为 0,AC9);指令注入门控断言(auto 有 / off 与未脱敏无,AC8);剥括号宽松修复用例(AC10)。
- 回归:现有全量 vitest 套件。
