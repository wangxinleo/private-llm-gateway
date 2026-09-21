# Design — thinking/reasoning 状态跳过

## 边界与契约

- 唯一改动点：`src/scanner/json-mask.ts`。新增 `isUpstreamModelState(path, value, root)` 判定，在 `scanValue` 顶部按节点判定跳过。
- `scanValue` 增加 `root` 参数（顶层传入 `JSON.parse(body)` 结果），递归透传；调用方 `maskJsonBody` 唯一。
- 跳过语义：命中判定 → 原样返回该节点（不扫描、不产生 finding、不改写），其外层兄弟节点照常处理。

## 判定规则（协议内嵌在路径形状里，不额外做协议探测）

| 形状 | 条件 | 跳过范围 |
|---|---|---|
| Anthropic 内容块 | `path = messages.<i>.content.<j>`，节点 `.type ∈ {thinking, redacted_thinking}`，且 `root.messages[i].role === "assistant"` | 整个块（含 `thinking`/`signature`/`data`） |
| Chat reasoning 键 | `path = messages.<i>.<K>`，`K ∈ {reasoning_content, reasoning, reasoning_details}`，且 `root.messages[i].role === "assistant"` | 该键子树 |
| Responses 项 | `path = input.<i>`，节点 `.type ∈ {reasoning, compaction}` | 整个项 |

- 只认 assistant 角色：user 消息同名字段（异常输入）不跳过。
- 只在"节点恰好携带标记类型"时生效：字段名单独出现于其它路径/形状不构成豁免（R2）。

## 与既有机制的交互

- `isBinaryPayload`（data URI / `data` 键）优先级不变，仍在字符串叶子处先判。
- Anthropic `redacted_thinking.data` 之前靠 `data` 键豁免；现在整块跳过，语义更准确（signature/data 都不再进入扫描）。
- `applyMasks` / registry / 响应还原零改动：跳过节点不产生 pairs。

## 测试设计（`src/__tests__/upstream-state-skip.test.ts`）

正例：
1. Anthropic assistant thinking（含手机号）→ thinking 字节不变、无 findings；
2. Anthropic assistant thinking（含自定义词 *）→ 同上；
3. Anthropic redacted_thinking（含 base64 data / signature）→ 整块不变；
4. Chat assistant reasoning_content（含手机号）→ 不变；
5. Responses input[].type=reasoning（含手机号）→ 不变。

反例：
6. Anthropic assistant 普通 text 块（含手机号）→ 照常脱敏；
7. Anthropic assistant tool_use input（含手机号）→ 照常脱敏；
8. user 消息 content 块 type=thinking（非法形状，含手机号）→ 照常脱敏（角色不符）；
9. user 消息含 `reasoning_content`（含手机号）→ 照常脱敏；
10. `signature` 出现在非 thinking 路径（含手机号）→ 照常脱敏。

* 自定义词用例沿用 custom-words 测试的临时 DB + vi.mock 模式。

## 回滚

单文件谓词 + 测试；回滚即删除谓词与 root 传参。无数据/协议迁移。
