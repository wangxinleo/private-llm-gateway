# D1/D4 重开评审:占位符原子性与模型保真指令

## 结论摘要

推荐 **B 路线:紧凑不透明唯一 token + 脱敏时条件注入极简保真指令**。

- 当前 `<<PRIVACY_MASK:CATEGORY:INDEX>>` 同时存在长度长、类别语义泄露、多 token 切分三个问题。
- 下行还原只能修复模型逐字回写;不能修复模型填充伪造值、改写 token 或丢弃 token。
- 零提示词(D4)与检索到的主流模式相反;主流普遍采用“原子/紧凑 token + 保留指令”双保险。
- FPE/拟真 surrogate 可作为企业级后续路线,不适合当前本地、每请求内存、无密钥管理的 MVP。

## 候选方案

| 方案 | 内容 | 结论 |
|---|---|---|
| A | 保留当前显式 tag,恢复一行保真指令 | 可作为低风险回退;仍保留长 tag 和类别诱导 |
| B | 改为 `__PM_1__` 等紧凑不透明实例 token,恢复一行保真指令 | **推荐**;同时降低伪造、改写和 SSE 切分风险 |
| C | 确定性 surrogate/FPE/HMAC,下行解密或反查 | 不纳入 MVP;密钥管理、算法和上下文一致性复杂 |
| D | 紧凑 token 但零提示词 | 不推荐;仍依赖模型原生行为,缺少第二道约束 |

## 维度比较

| 维度 | A | B | C | D |
|---|---|---|---|---|
| 精确还原 | 高 | 高 | 中至高 | 中 |
| 模型填充风险 | 中 | **低** | 低 | 中 |
| SSE 跨 chunk 风险 | 高 | **低** | 低 | 低 |
| prompt token 成本 | 高 | **低** | 中 | 低 |
| 实现复杂度 | 低 | 中 | 高 | 中 |
| 本地单租户适配 | 高 | **高** | 中低 | 高 |
| 审计可读性 | 高 | 中(类别留在内部映射) | 低 | 中 |

## 推荐设计边界

- token 格式建议 `__PM_<N>__`;`N` 仅要求请求内唯一,不是密码、不是跨请求稳定 ID,不对模型暴露类别名。
- `MaskRegistry` 内部继续保存 `token → raw value` 与 category 元数据;审计和调试不依赖模型可见 token。
- token 紧凑不等于保证任何 tokenizer 都切成单 token;网关仍保留 hold-back 流式匹配器。
- 有脱敏时才注入极简指令;无脱敏请求零注入。
- 默认注入到已有 system/developer/instructions 的可信位置;没有安全提示词面时保留协议兼容的降级行为。
- `off` 保留为回退开关,但不作为默认方案。

## 推荐指令

```text
Preserve tokens matching __PM_<N>__ exactly. Treat each token as an opaque literal: never expand, replace, invent, renumber, or omit it.
```

不把 token 当作安全凭证,不要求模型推导原文;只约束复制保真度。

## 验证方案

- 使用固定模型 fixture 做 A/B:旧显式 tag + 无指令、旧显式 tag + 短指令、紧凑 token + 短指令、紧凑 token + 无指令。
- 样本覆盖:正文回显、同类多值、Markdown/代码块、tool arguments、SSE 单字节切分、非流式 JSON、coding-agent diff。
- 指标:token exact echo、伪造值出现率、删除/改写率、SSE 输出一致性、请求 token 增量。
- 对声明支持的模型,fixture 必须达到 100% token 保真;不兼容模型应进入支持矩阵,不能用网关还原伪造值。

## 子任务回流

- grok-4.6:推荐 B,要求重开 D1/D4,保留 `off` 回退,建议 universal-on-masked 注入。
- gemini-3.8-flash:建议 `__PM_N__`、用户故事、Given/When/Then、迁移和 feature flag 文案。

本文件是评审证据与候选方案,待用户确认后再把 D1/D4 变为最终决策。

## 最终裁决(v3,2026-09-10,已收敛)

用户裁定采用**语义紧凑占位符**方向:正则/词库命中后替换为 `{{CATEGORY_HEX4}}`(如 {{PHONE_A1B2}}、{{CONNSTR_C3D4}}),原文绝不出网。

- **D1 v3**:`{{CATEGORY_CODE_HEX4}}`;类别短码白名单(≤12 字符);后缀 = 原文确定性哈希截 4 位十六进制 + 请求作用域内冲突线性探查,保证占位符↔原文严格双射;旧 explicit/legacy 只读透传。
- **D4 v3**:保留一行极简保真指令(禁止展开/伪造/改写/删除占位符,文案无原文),复用 disambiguation.ts 既有协议感知注入管线;`PRIVACY_DISAMBIGUATION_MODE` 收敛为 auto|off(默认 auto,旧值 prefix/json-meta 解析为 auto);门控 = registry 非空。不再删除该文件与配置。
- **子任务评估记录**:grok-4.6 反对语义格式并建议"保留旧非唯一格式"——该建议与已实证的核心缺陷矛盾,不予采纳;其"指令仍必要"结论采纳。gemini-3.8-flash 提供 BNF/短码表/安全不变式/场景化 AC 与 feature flag,采纳后收敛(其"新增独立开关"建议被否,复用现有 mode 变量避免双开关冗余)。
- **安全不变式进入 PRD**(R10/AC9):发往上游的载荷中,任一被脱敏原文出现次数恒为 0。
