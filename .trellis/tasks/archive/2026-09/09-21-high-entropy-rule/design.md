# Design — HIGH_ENTROPY 规则（自算 bigram 交叉熵）

## 数据与许可（路径 B：自算表）

- 语料：Project Gutenberg #1342 *Pride and Prejudice*（公有领域，738KB；URL + sha256 写入生成物头部）。
- 生成脚本 `scripts/gen-entropy-table.mjs`：语料 → 归一（lowercase；数字并入 `#` 类；非字母数字作分隔）→ bigram 计数（含 `^`/`$` 边界）→ add-α 平滑（α=0.1，V=29）→ `cost = -log2(P)` → 生成 `src/scanner/entropy-table.ts`。
- 表中符号 29 个：`a..z`(0-25) + `#`(26 数字类) + `^`(27) + `$`(28)；表为 `Float64Array(29*29)` 扁平数组 + `Uint8Array(128)` 字符→索引映射（热循环零对象查找）。
- 数字类说明：语料中数字稀少 + 平滑 → letter→`#`、`#`→任何 的代价自然偏高（≈9-11 bits），正是"随机串平均分高、自然词平均分低"的分离来源；不设人工常量。

## 算法（`src/scanner/entropy.ts`）

```
tokenizeBlocks(text)  → [A-Za-z0-9]+ 块(保留偏移)，len>8，排除纯数字
entropyScore(block)   → 归一字符类后逐字符查表求和 / (len+1)
isHighEntropyBlock(b) → 多样性下限(自有规则) && score > threshold(len)
```

- **多样性下限（自有规则，非照搬）**：`distinct >= min(6, max(3, ceil(len*0.4)))`，用于拒绝 `aaaa…`/`abab…` 类重复串；校准脚本验证。
- **长度插值阈值（自校准）**：锚点 = 留出语料自然 token 分数的 p99（每长度桶 9/10/11/12/13/16/20/24/32/40/48/64/80/96/112/128），线性插值，128+ 用末值；数值由 `scripts/calibrate-entropy.mjs` 产出并写入 `entropy-table.ts`（锚点即"自然文本 FP≈1%"的定义）。

## 接入

| 位置 | 变更 |
|---|---|
| `types.ts` | `FindingCategory` + `HIGH_ENTROPY` |
| `config.ts` | `DEFAULT_RULE_TOGGLES.HIGH_ENTROPY = false` |
| `mask-tag.ts` | 短码 `HIGHENT` |
| `dashboard/words/page.tsx` | 规则清单加入 |
| `context-window.ts` | `push(scanHighEntropy(text))`（`isRuleEnabled` 内部门控；关闭即零开销；无锚点需求，全文） |

## 性能设计（1M 硬门槛）

- 关闭：`isRuleEnabled` 短路，零成本。
- 开启：tokenize 单遍正则 + 逐字符查表，O(n)；无回溯（`[A-Za-z0-9]+`）；无中间数组拼接（直接产出 findings）。
- 预算：1MB 增量 ≤100ms；基准测试 + 桌面实测双证据。
- 上限防护：单块 >256 字符时跳过评分（长随机串在超长块内概率极低，且避免极端输入成本）；写入设计边界。

## 校准与测试

- `scripts/calibrate-entropy.mjs`：留出语料（语料后半 + 仓库英文文档/注释）算 FP；随机 hex/base62 9/12/16/24/32 算召回；输出报告（写入任务 `research/calibration.md`）。
- 测试：`high-entropy.test.ts`（正例/反例/开关默认关/占位符还原）、`benchmarks/high-entropy-1mb.test.ts`（性能）。

## 已知边界（文档声明，抄评估结论）

hash/标识符/压缩内容/非英文转写可能误报；被分隔符拆开的凭据可能漏检；默认关即为此设。不进入 block 语义（同自定义词）。

## 回滚

新增文件为主 + 4 处一行接入；回滚 = revert 提交。
