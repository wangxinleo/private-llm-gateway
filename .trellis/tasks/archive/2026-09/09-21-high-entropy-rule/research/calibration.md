# HIGH_ENTROPY 校准报告（自算表，2026-09-21）

## 方法

- **代价表**：Project Gutenberg #1342 *Pride and Prejudice*（公有领域，738KB；sha256=81300b79e8a8d65a…），lowercase + 数字并入 `#` 类，bigram 计数 + add-α（α=0.1）平滑 → `-log2(P)`；生成物 `src/scanner/entropy-table.ts`（29×29 扁平表 + provenance）。
- **锚点**：校准池 = 文学留出 token（语料后半）+ 自然词拼接样本（每桶 300），每桶取 p99.9 分数；线性插值；生成物 `src/scanner/entropy-anchors.ts`。**仓库代码/锁文件文本不参与标定**（否则随机片段会把阈值推到无意义水平，实测过一次：hex 召回崩到 0）。
- **判定链**：长度>8 且非纯数字 → 标准哈希守卫（纯小写 hex @ 32/40/64/128 跳过）→ 多样性下限（`distinct >= min(6, max(3, ceil(len*0.4)))`）→ 分数 > 插值阈值。
- **脚本**：`npm run gen:entropy-table`、`npm run calibrate:entropy`（含生成物完整性校验：重算表与文件必须一致，maxDiff<1e-3）。

## 实测数字（固定种子，2000 样本/点）

| 指标 | 值 |
|---|---|
| FP 文学留出 | **0.02%**（1/5231） |
| FP 自然词拼接 | **0.17%**（8/4800） |
| FP 仓库文档(.md) | 1.37%（328/23948） |
| FP 仓库全部(含锁文件/代码) | 4.11%（1395/33924；标准哈希守卫另跳过 601 个） |
| 召回 hex | 9→84.1% / 12→87.1% / 16→92.3% / 24→96.1% / **32/40/64→0%（哈希守卫代价）** |
| 召回 base62 | 9→99.3% / 12→99.9% / 16→100% / 24→100% / 32→100% / 40→100% / 64→100% |
| 重复串守卫 | 5/5 被拒（aaaaaaaaaa 等） |
| 锚点 | 9:5.513 … 16:5.379 … 32:5.151 … 64:4.906 … 128:4.746 |

## 边界分析（进入 spec 的结论）

1. **标准哈希守卫的取舍**：纯小写 hex 且长度恰为 32/40/64/128 直接放行——与"随机 hex 凭据"统计上不可区分，而代码/锁文件里的哈希是最大误报源（仓库文本实测占命中的主要部分）。代价：恰好为这些形态的 hex 密钥会漏检（已声明）。
2. **剩余仓库文本误报（~4%）构成**：12-16 位短 hex 片段（git 短 SHA 等，统计上确实随机）、少见英文复合词/标识符（`breadcrumbs`/`typography` 类）。属 bigram 模型固有边界（竞品文档同样声明 identifier/hash 边界），规则默认关即为此设。
3. **长块上限 256**：超长连续 alnum 块（多在 base64 大 blob）跳过，防误伤编码载荷。
4. **分隔符会漏**：被 `-`/`_`/`/` 拆开的凭据不在单块内（与竞品同边界）。

## 性能（1MB 基准 + 桌面实测）

- 基准（`src/__tests__/benchmarks/high-entropy-1mb.test.ts`，1MB 文本）：
  - 关闭：direct 0.00ms（门控短路）；管道 12.02ms（既有扫描基线）
  - 开启：direct **5.19ms**；管道 16.66ms；**增量 4.64ms**（预算 100ms，20× 余量）
- 桌面实测（1.5MB 请求体，真实链路 :3210 → mock :8787，开启 vs 关闭各 3 次稳态）：
  - 规则开：审计 duration 79/93/93ms；规则关：66/69/68ms → **增量 +13~27ms** ✓
  - 端到端（含 2MB echo 响应还原/分析）：开 151-153ms / 关 122-126ms
  - 脱敏验证：上游实收 1576KB，`{{HIGHENT_...}}` 占位符存在，原始随机 token 与手机号零残留

## 压测附带发现（F-A1，已随本任务修复）

- **`Expect: 100-continue` 导致大请求 502**：curl 对大体积 POST（>1KB）默认携带该头；
  `forwardRequest` 原样透传 → undici 抛 `UND_ERR_NOT_SUPPORTED` → 所有大请求 502
  （实测：带 Expect 502 / 显式去掉 200）。修复：转发前丢弃 `expect` 与 RFC 7230 逐跳头
  （connection/keep-alive/proxy-connection/te/trailer/transfer-encoding/upgrade），
  Authorization 等业务头照常透传；回归测试 `forwarder-headers.test.ts`。
