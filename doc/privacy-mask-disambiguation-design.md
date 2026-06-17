# Privacy Mask Disambiguation 详细技术设计

## 背景

当前代理会在入站请求进入上游前执行扫描与脱敏。

- 入口位于 `src/app/api/[[...path]]/route.ts`。
- 扫描决策位于 `src/scanner/pipeline.ts`。
- JSON 字符串字段脱敏位于 `src/scanner/json-mask.ts`。
- 脱敏替换逻辑位于 `src/scanner/pii.ts` 的 `applyMasks()`。

当前行为的问题不在于“是否脱敏”，而在于“脱敏后的内容如何被 LLM 理解”。

例如：

- `alice@example.com` 会被替换为 `[EMAIL]`
- `13800138000` 会被替换为 `[PHONE]`
- 类似密钥值会被替换为 `[CONTEXTUAL_SECRET]`

这些短占位符虽然能保护原始内容，但它们缺少明确语义边界。对于上游 LLM 而言，`[EMAIL]` 可能被误解为：

- 用户原始输入里本来就出现了这个字面量
- 一种业务枚举值或代码常量
- 一段应该被继续推理、补全或引用的真实内容

这会导致模型在文件解读、代码分析、日志解释、错误排查、抽取任务中产生歧义。

## 设计目标

### 核心目标

让上游 LLM 明确知道：

1. 某些文本片段不是用户原文，而是隐私代理插入的替代标记
2. 这些标记表示“原始内容存在，但已被保护性移除”
3. 模型不应将这些标记当作真实业务值、真实文件内容或真实代码内容推理

### 次级目标

1. 保持当前代理低延迟特性
2. 不泄露原始敏感值
3. 保持对现有代理链路的兼容性
4. 尽量减少对上游服务协议的破坏
5. 允许按内容类型采取不同注入策略

### 非目标

1. 不恢复原始敏感值
2. 不做可逆脱敏
3. 不解析上传文件内容
4. 不改造出站 SSE 内容语义
5. 不引入依赖具体 LLM 厂商的私有协议

## 现状分析

## 数据流

当前入站请求链路如下：

`client -> src/app/api/[[...path]]/route.ts -> scanner -> upstream`

关键步骤：

1. `handleRequest()` 提取请求体文本与文件名元数据
2. 根据 `content-type` 选择：
   - JSON：`maskJsonBody(bodyText, scanFn)`
   - 非 JSON：`runPipeline(bodyText, bodySize, filenames)`
3. 若命中 `block`，直接拒绝
4. 若命中 `mask`，将 `result.maskedBody` 透传给上游
5. 若上游响应为 `text/event-stream`，则直接调用 `createStreamingResponse()` 透传

## 现有脱敏语义问题

### 问题 1：占位符过短

`[EMAIL]`、`[PHONE]` 看起来像普通文本 token，不足以表达“这是代理插入的替代值”。

### 问题 2：缺少请求级声明

即使模型看到了 `[EMAIL]`，它也不知道这是：

- 系统预处理结果
- 上游业务自己生成的标签
- 用户 prompt 中原本就有的文本

### 问题 3：结构化上下文缺失

当前 `ScanResult` 仅返回：

- `findings`
- `maskedBody`
- `action`

缺少供后续注入层使用的摘要信息，例如：

- 是否发生脱敏
- 命中了哪些类别
- 替换了多少处
- 是否需要附加提示语

### 问题 4：不同内容类型未分层处理

JSON、纯文本、表单、multipart 文本字段的风险相同，但最佳消歧方式不同：

- JSON 更适合结构化元数据
- 纯文本更适合前缀声明
- Chat 请求更适合 system/developer 注释

## 总体设计

本方案采用“双层消歧”设计：

1. **替换标记升级**：把短占位符升级为明确的隐私代理标记
2. **请求级语义注入**：仅在发生脱敏时，为上游输入附加简短、稳定、不可歧义的说明

默认同时启用两层。

## 设计概览

### 层 1：标记格式升级

将当前：

- `[EMAIL]`
- `[PHONE]`
- `[ID_CARD]`
- `[BANK_CARD]`
- `[CONTEXTUAL_SECRET]`

升级为统一格式：

- `<<PRIVACY_MASK:EMAIL>>`
- `<<PRIVACY_MASK:PHONE>>`
- `<<PRIVACY_MASK:ID_CARD>>`
- `<<PRIVACY_MASK:BANK_CARD>>`
- `<<PRIVACY_MASK:CONTEXTUAL_SECRET>>`

设计原则：

1. 显式包含 `PRIVACY_MASK`
2. 使用低碰撞分隔符 `<< >>`
3. 保留类型名，便于上游理解语义
4. 不包含原始值任何片段

### 层 2：请求级声明注入

当且仅当 `action === "mask"` 时，在转发前附加一条稳定声明：

`Notice: tokens like <<PRIVACY_MASK:EMAIL>> were inserted by the privacy proxy and do not represent original source text.`

说明：

1. 声明必须极短，避免影响 token 成本
2. 声明必须稳定，便于测试
3. 声明必须只描述“语义边界”，不描述原始值
4. 声明必须只在发生脱敏时出现

## 分层架构改造

## 1. 扫描层

### 目标

扫描层继续负责“发现”和“替换”，不负责决定如何把说明注入到不同协议。

### 建议改造

扩展 `src/types.ts` 中的结果模型。

当前：

```ts
export interface ScanResult {
  findings: Finding[];
  maskedBody: string;
  action: ActionType;
}
```

建议扩展为：

```ts
export interface MaskSummary {
  applied: boolean;
  categories: FindingCategory[];
  replacementCount: number;
}

export interface ScanResult {
  findings: Finding[];
  maskedBody: string;
  action: ActionType;
  maskSummary: MaskSummary;
}
```

### 设计说明

- `applied`：是否至少发生一次实际替换
- `categories`：去重后的脱敏类别
- `replacementCount`：实际替换次数，不是 finding 数组长度的简单镜像

### 落点

- `src/scanner/pii.ts`
- `src/scanner/context-key.ts`
- `src/scanner/secrets.ts`
- `src/scanner/pipeline.ts`
- `src/scanner/json-mask.ts`

## 2. 替换层

### 目标

将脱敏标记格式统一收口，避免散落在各规则模块中。

### 问题

当前 `maskTag` 在各扫描规则里内联定义，不利于统一升级。

### 建议改造

新增统一的 mask tag 生成器，例如：

- `src/scanner/mask-tag.ts`

建议接口：

```ts
export function buildMaskTag(category: FindingCategory): string;
```

默认输出：

```ts
<<PRIVACY_MASK:EMAIL>>
<<PRIVACY_MASK:PHONE>>
```

### 设计收益

1. 所有替换标记由一处生成
2. 未来支持多种格式更容易
3. 测试用例不会散落修改

## 3. 消歧注入层

### 目标

根据请求内容类型，把“代理说明”以最小破坏方式注入到上游输入。

### 建议新增模块

- `src/proxy/disambiguation.ts`

建议接口：

```ts
interface DisambiguationContext {
  contentType: string;
  originalBody: string;
  maskedBody: string;
  scanResult: ScanResult;
}

export function applyDisambiguation(context: DisambiguationContext): string;
```

### 行为规则

#### 规则 A：未脱敏不注入

若 `scanResult.action !== "mask"` 或 `maskSummary.applied === false`，直接返回 `maskedBody`。

#### 规则 B：JSON 按结构注入

对于 JSON 请求，优先采用两种策略之一：

##### 策略 B1：顶层元数据注入

如果请求体是对象，向顶层追加：

```json
{
  "_privacy_meta": {
    "masked": true,
    "mask_types": ["EMAIL", "PHONE"],
    "notice": "Tokens like <<PRIVACY_MASK:EMAIL>> were inserted by the privacy proxy and are not original content."
  }
}
```

优点：

1. 结构化清晰
2. 对工具链和后处理友好

风险：

1. 某些上游 API 严格校验 schema，新增字段可能失败

##### 策略 B2：消息内容前缀注入

对于典型 LLM 请求格式，若存在 `messages[*].content`，则在首个可写入的 system/developer/user 文本消息前加前缀：

```text
[Privacy notice] Tokens like <<PRIVACY_MASK:EMAIL>> were inserted by the privacy proxy and are not original source text.
```

优点：

1. 更兼容 schema 严格的上游接口
2. 与模型实际阅读路径更接近

建议默认优先级：

1. 检测到典型 chat messages 结构时，使用 B2
2. 否则对宽松 JSON 对象使用 B1
3. 若不满足则回退为文本前缀策略

#### 规则 C：纯文本按前缀注入

对 `text/plain`、`application/x-www-form-urlencoded` 扫描后的文本体，使用前缀声明：

```text
[Privacy notice] Tokens like <<PRIVACY_MASK:EMAIL>> were inserted by the privacy proxy and are not original source text.

<masked body>
```

#### 规则 D：multipart 不修改文件内容部分

对于 multipart：

1. 仍只扫描文本字段与文件名元数据
2. 不重写二进制文件内容
3. 仅在文本字段中发生脱敏时，对对应文本字段值注入前缀或替换标记

v1.1 建议先不对 multipart 做复杂结构注入，只升级文本字段中的 mask tag。

## 4. 转发层改造

### 当前

`src/app/api/[[...path]]/route.ts` 在 `action === "mask"` 时直接转发 `result.maskedBody`。

### 建议

改为：

1. 扫描得到 `ScanResult`
2. 若 `action === "mask"`，调用 `applyDisambiguation()` 得到 `forwardBody`
3. 用 `forwardBody` 发送给上游

建议伪代码：

```ts
const scanResult = ...;

const forwardBody = scanResult.action === "mask"
  ? applyDisambiguation({
      contentType,
      originalBody: bodyText,
      maskedBody: scanResult.maskedBody,
      scanResult,
    })
  : hasBody
    ? bodyText
    : undefined;
```

### 原则

1. 只有 mask 请求才进入消歧层
2. block 与 allow 行为不变
3. 不在 `forwardRequest()` 内部做语义注入，避免代理职责混乱

## 5. 响应层与流式处理

### 当前

`src/proxy/streaming.ts` 仅透传 SSE。

### 结论

本功能不建议修改出站 SSE 内容。

理由：

1. 本次歧义发生在“LLM 看到被脱敏的入站内容”阶段
2. 修改 SSE 会引入协议兼容风险
3. 出站内容通常不是原始敏感值，而是模型响应

### 可选增强

若后续需要可观测性，可在非生产调试模式下增加响应头：

- `X-Privacy-Masked: true`
- `X-Privacy-Mask-Types: EMAIL,PHONE`

仅用于内部调试，不保证上游可见。

## 配置设计

所有配置通过环境变量注入，符合仓库约束。

建议新增：

### `PRIVACY_MASK_FORMAT`

可选值：

- `legacy`
- `explicit`

默认：`explicit`

行为：

- `legacy` -> `[EMAIL]`
- `explicit` -> `<<PRIVACY_MASK:EMAIL>>`

### `PRIVACY_DISAMBIGUATION_MODE`

可选值：

- `off`
- `prefix`
- `json-meta`
- `auto`

默认：`auto`

行为：

- `off`：只替换，不注入声明
- `prefix`：统一走文本前缀策略
- `json-meta`：JSON 顶层元数据优先
- `auto`：按内容类型自动选择最佳策略

### `PRIVACY_NOTICE_TEXT`

默认值为内置固定英文声明。

允许覆盖，但建议限制长度。

### `PRIVACY_DEBUG_HEADERS`

可选值：`true | false`

默认：`false`

用于控制是否追加调试响应头。

## 数据结构设计

## `Finding`

当前结构可以保留，但建议减少在规则定义里手写 `maskTag`。

建议：

```ts
export interface Finding {
  category: FindingCategory;
  action: ActionType;
  matched: string;
  maskTag?: string;
}
```

继续保留 `maskTag` 字段，兼容现有逻辑。

## `MaskSummary`

新增：

```ts
export interface MaskSummary {
  applied: boolean;
  categories: FindingCategory[];
  replacementCount: number;
}
```

## `AuditEntry`

当前审计只记录类别数组和动作，建议可选扩展：

```ts
export interface AuditEntry {
  ...
  maskApplied?: boolean;
  maskCategories?: FindingCategory[];
  maskCount?: number;
}
```

注意：

1. 不记录原始值
2. 不记录替换后全文
3. 仅记录摘要

## 兼容性策略

## 与现有行为兼容

### 默认兼容边界

1. `block` 行为完全不变
2. `allow` 行为完全不变
3. 仅 `mask` 行为增强

### 向后兼容策略

通过 `PRIVACY_MASK_FORMAT=legacy` 保持旧占位符。

通过 `PRIVACY_DISAMBIGUATION_MODE=off` 完全关闭请求级声明注入。

这样可以灰度发布：

1. 先切换新占位符格式
2. 再逐步开启请求级注入

## 风险分析

## 风险 1：上游接口严格校验 JSON schema

风险：新增 `_privacy_meta` 会导致请求失败。

缓解：

1. `auto` 模式优先使用 message 前缀注入
2. 仅在确认上游允许额外字段时启用 `json-meta`

## 风险 2：前缀注入影响业务语义

风险：某些非 LLM 文本接口会把前缀当正文处理。

缓解：

1. `auto` 模式仅对高概率 LLM 请求启用前缀
2. 允许按环境变量关闭

## 风险 3：替换标记破坏下游格式

风险：某些正则或解析器依赖旧的 `[EMAIL]` 形式。

缓解：

1. 提供 `legacy` 回退
2. 先升级内部测试与文档

## 风险 4：替换计数与实际替换次数不一致

风险：同一值多次出现时，`findings.length` 不等于 `replaceAll()` 的次数。

缓解：

1. 在实际替换函数中返回精确计数
2. 不用 `findings.length` 充当统计值

## 推荐实现顺序

## Phase 1：最小可用版本

1. 新增统一 mask tag 生成器
2. 将默认占位符升级为 `<<PRIVACY_MASK:TYPE>>`
3. 扩展 `ScanResult.maskSummary`
4. 在 `route.ts` 中为 mask 请求引入消歧注入层
5. 默认启用 `prefix/auto`

这一步即可解决大部分 LLM 歧义问题。

## Phase 2：JSON 智能注入

1. 对常见 `messages` 结构注入 notice
2. 对宽松 JSON 对象支持 `_privacy_meta`
3. 增加更多兼容测试

## Phase 3：审计增强

1. 增加脱敏摘要字段
2. 在 dashboard 中展示“发生了脱敏且进行了语义标注”

## 测试设计

## 单元测试

建议新增：

### `src/__tests__/mask-tag.test.ts`

验证：

1. `EMAIL -> <<PRIVACY_MASK:EMAIL>>`
2. `PHONE -> <<PRIVACY_MASK:PHONE>>`
3. `legacy` 模式输出旧格式

### `src/__tests__/disambiguation.test.ts`

验证：

1. 未发生脱敏时不注入 notice
2. 纯文本 mask 时会插入 notice
3. JSON 普通对象在 `json-meta` 模式下插入 `_privacy_meta`
4. chat `messages` 结构在 `auto` 模式下注入首条 notice

### 更新 `src/__tests__/json-mask.test.ts`

补充：

1. mask 结果包含新格式标记
2. JSON 结构不被破坏
3. notice 注入后仍是合法 JSON

### 更新 `src/__tests__/pipeline.test.ts`

补充：

1. `maskSummary.applied`
2. `maskSummary.categories`
3. `maskSummary.replacementCount`

## 集成测试

建议新增端到端场景：

1. `POST /api/...`，正文包含 email
2. 代理转发到 mock upstream
3. 断言上游收到的是：
   - 新格式 mask tag
   - 正确的 notice 注入
   - 不包含原始值

## 日志与审计

日志与审计只记录摘要，不记录正文。

建议增强点：

1. `action=mask` 时日志追加 `maskCount`
2. 审计记录追加 `maskApplied` 与 `maskCount`
3. 不把 notice 文本写入审计

## 决策建议

本项目推荐默认采用以下配置：

### 默认配置

- `PRIVACY_MASK_FORMAT=explicit`
- `PRIVACY_DISAMBIGUATION_MODE=auto`
- `PRIVACY_DEBUG_HEADERS=false`

### 默认策略

1. 所有脱敏标记统一改为 `<<PRIVACY_MASK:TYPE>>`
2. 发生脱敏时自动插入极短英文 notice
3. 对典型 chat JSON 优先注入到消息内容，而不是顶层加字段
4. 对未知纯文本请求走 notice 前缀策略

## 预期收益

实施后，上游 LLM 将更容易正确理解：

1. 某些内容已被代理替换
2. 替换后的 token 不是原始文本
3. 不应基于这些 token 做过度字面推理

这能显著降低以下问题：

1. 把占位符当原始文件内容继续分析
2. 把占位符当真实代码常量引用
3. 把占位符当真实配置值、日志值或用户输入复述
4. 在总结、抽取、问答任务中输出误导性结论

## 实施边界总结

本方案是对现有“mask-and-forward”的语义增强，不改变隐私保护原则。

它不让模型看到更多原文，只让模型更明确地知道：

`这里有内容被保护性替换了，这不是原始文本。`
