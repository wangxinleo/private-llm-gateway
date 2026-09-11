# 主流方案对比:下行还原 vs 业界实践

> 检索:grok-search 三路(grok-4.2 实时搜索,2026-09-10)。Q1 商业 LLM 网关六家;Q2 通用脱敏标准/库三套;Q3 流式还原公开实现。

## 一、商业 LLM 网关(Q1)

| 产品 | 占位符方案 | 映射存储 | 流式还原 |
|---|---|---|---|
| Protecto.ai | 唯一原子 token(`pt_…`,tokenizer 级单 token) | 持久 Vault(加密 KV + TTL + 审计) | 实时(token 原子,即现即换) |
| Skyflow | Vault 唯一 token | 持久 Vault(跨请求/会话) | 实时 |
| Basis Theory | Vault token 或拟真 surrogate | 持久 Vault | token:实时;surrogate:**缓冲至流尾**(多 token 值) |
| Lasso | 类别标签(`[EMAIL]`)或简单占位符 | **每请求内存**为主 | 实时 |
| Portkey | 唯一 token / 类别占位符 | Vault 或每请求内存 | 原子 token 实时;surrogate 缓冲 |
| TrueFoundry | 唯一 token / 类别标签 | Vault 或会话级 | token 实时;surrogate 缓冲 |

**跨产品共识(Q1 原文)**:所有产品都"via system prompt or few-shot **instruct the LLM** to output the placeholder"——即主流 = 原子 token + 模型指令双保险。

## 二、通用标准/库(Q2)

- **Google DLP**:surrogate + `DECRYPT_TRANSFORM`(确定性加密)或 vault 映射;re-identify 模板。
- **Presidio**:anonymize/deanonymize 算子、faker 拟真值、FPE(FF1/FF3)、hash、自定义 lambda;显式 mapping table + deanonymize。
- **NIST FPE (SP 800-38G)**:确定性加密即映射,无表;PCI/GDPR/HIPAA 场景标准。
- LLM 场景共识建议:deterministic surrogate 保证一致性;输出侧必须反替换;会话轮次内维护 mapping context;已知缺陷:LLM 可从上下文推断原文。
- 确定性加密 vs Vault 取舍:免存储但 key 泄露 = 全量暴露;Vault 有延迟(~1-5ms)但可审计可轮换。

## 三、流式还原算法(Q3)

- **hold-back 缓冲 + 增量匹配即业界标准技术**(与 design.md §3.2 一致);Protecto 文档明确 buffer-based partial-match 处理。
- 无大型公开仓库完整覆盖"LLM 占位符 + SSE + partial-match"组合——专有代理/SDK 内实现,需自研(我们正如此做)。
- 实现建议与我们设计吻合:预编译模式、O(chunk + patterns)、EOF flush、嵌套占位符单遍处理。

## 四、匹配度评估

| 维度 | 我们 | 主流 | 匹配度 |
|---|---|---|---|
| 骨架(扫描→脱敏→转发→还原) | 一致 | 全行业一致 | ✅ 完全匹配 |
| 占位符唯一性 | 实例 ID | 唯一 token(商业)/确定性加密(标准库) | ✅ 匹配 |
| 占位符原子性 | 多 token ASCII tag | **单 token 原子**(商业标配) | ⚠️ 不及——由 hold-back 匹配器补齐,属必走路径 |
| 映射存储 | 每请求内存 | Lasso 同款轻量派;重口走 Vault | ✅ 匹配本地单租户定位(Vault 属非目标,合理) |
| 流式还原 | 增量 hold-back | 同一标准技术 | ✅ 高度匹配 |
| 模型指令 | **D4 已删除** | **全部产品注入指令** | ❌ 唯一显著偏差(风险已知悉接受) |
| 审计边界 | 审计后还原 | Vault 审计语义 | ✅ 匹配 |

## 五、偏差与可选演进(记录,不改变已收敛设计)

1. **D4(零指令)是与主流的唯一结构性偏差**:主流用"原子 token + 指令"双保险;我们裸奔多 token tag,伪造填充敞口大于业界。已由用户裁决接受,复活路径见 research/notice-decision.md。
2. **可选演进(未来迭代)**:紧凑 tag(缩短 LLM token 数)可同时降低切分概率与伪造面;涉及 D1 格式变更,暂不动。
3. **确定性加密路线(FPE/HMAC)评估过,不采纳**:免存储跨请求一致性确有吸引力,但引入 key 管理复杂度,与本地网关定位及"非跨请求持久化"非目标冲突。

## 结论

方案骨架、映射唯一性、流式算法、存储生命周期、审计边界五项与主流高度匹配;占位符原子性差距由自研增量匹配器补齐(Q3 证实无现成轮子);D4 为唯一已知偏差,风险已显式接受并存档。
