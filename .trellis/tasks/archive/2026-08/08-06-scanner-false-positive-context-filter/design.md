# 设计:扫描范式重构 — 高风险资产配置 + 上下文窗口扫描

## 1. 范式对比

```
【旧范式】全文扫描 + 事后过滤(误报多、性能差)
  text → scanSecrets/scanContextKey/scanPii(全文×全管道) → findings 满屏误报 → applyExclusions(静态,打地鼠)

【新范式】定位高风险资产 → 只扫描其上下文窗口(误报少、性能优)
  text → 定位白名单命中值(高风险资产) ← 高风险值配置(域名/邮箱/账户白名单,泛值通配)
       → 对每个白名单命中值切片 [±200 字符] 窗口
       → 窗口内抓严:任何疑似密钥字符串(无序8+位字符 / 口令标志后值 / 关键词 / 强规则前缀)
       → 有疑似 → 产出 findings(脱敏);无 → 跳过
  ★ 白名单区域外完全不扫描 → prose URL/commit sha/BasicFlow 天然不误报
  ★ 扫描量 = 白名单命中数 × 窗口大小,远小于 全文 × 全管道 → 天然性能提升
```

## 2. 数据流

```
请求 body(text)
  → extractBodyText
  → [新]locateHighRiskAssets(text, config): 找出白名单命中值及其位置
      ├─ 域名白名单命中: URL 中的 host 匹配 *.ccload.com 等
      ├─ 邮箱白名单命中: 邮箱匹配 *@*.ccload.com 等
      └─ 帐户白名单命中: 登录账户名(如 wangxinleo)匹配 accounts 白名单
  → [新]scanContextWindows(assets, text): 对每个命中值切片 ±200 窗口
      └─ 窗口内: scanSecrets(window) + scanContextKey(window) + scanPii(window) + 内置高信号前缀检测 + 无序8+位字符 + 口令标志后值(D7 抓严)
  → findings(仅窗口内命中)
  → applyExclusions(可选保留,作为用户手动兜底;默认空)
  → logAudit / mask / forward
```

## 3. 高风险值配置(schema)

替换 `scanner_exclusions` 配置位,新 key:`high_risk_assets`,类型 `json_array`:

```json
{
  "domains": ["*.ccload.com", "*.gffunds.com"],
  "emails": ["*@*.ccload.com"],
  "accounts": ["wangxinleo", "ft-*"]
}
```

- **泛值通配语法**:`*` 匹配任意字符序列(含空)。`*.ccload.com` 匹配 `app.ccload.com`、`api.gffunds.com` 风格;`*@*.ccload.com` 匹配任意用户 + 任意子域。
- **匹配目标**:
  - domains → 扫描文本中 URL 的 host 部分(用 URL 解析或正则提取 host)
  - emails → 扫描文本中的邮箱地址(`[^@\s]+@[^\s]+` 提取后匹配)
  - **accounts → 登录账户名**(如 `wangxinleo`、`ft-*`)。作用:定位"用户身份出现的敏感区域"——账户名出现在哪里,其上下文窗口就是扫描区域。**不是 token/密钥配置,不匹配任意值**。
- **内置高信号基础层(不可配置关闭)**:`sk-`/`eyJ`/`ghp_`/`sk-ant-`/`xox` 等 STRONG_RULES 前缀,即使不在白名单,窗口内也检测且命中即脱敏 → 防漏报。
- **默认值**:预置 `*.ccload.com`、`*.gffunds.com`,`emails`/`accounts` 默认空。用户可增删。

## 4. 配置迁移

- `config-loader.ts`:删除 `scanner_exclusions` 加载(43-44 行),新增 `high_risk_assets` 加载。
- `refreshConfig`:删除 `scanner_exclusions` 分支,新增 `high_risk_assets` 分支。
- `src/config.ts`:删除 `SCANNER_EXCLUSIONS`/`DEFAULT_EXCLUSION_RULES`,新增 `HIGH_RISK_ASSETS` 状态容器。
- `src/types.ts`:删除 `ExclusionRule`,新增 `HighRiskAssets`(domains/emails/accounts 数组)。
- **admin UI**:Settings 页的"Scanner exclusion rules"改为"High-risk assets"(域名/邮箱/帐户三栏输入)。
- **数据库存量**:`system_config` 中已存的 `scanner_exclusions` 行保留不删(避免破坏),但不再加载;新配置 `high_risk_assets` 首次初始化时写入。

## 5. 窗口扫描(抓严)

对每个白名单命中值的 ±200 字符窗口,检测并过滤**任何疑似密钥**的字符串:

1. **无序 8+ 位字符**:非纯字母单词、非纯数字、非重复字符;含数字或符号或混合大小写 → 视为疑似密钥脱敏。例:`aB3x9K2mQwe7`、`wx456_klm`。判定细则(防误伤):
   - 纯字母单词(如 `password` 本身、`BasicFlow`)→ 不视为无序字符
   - 纯数字(如 `12345678`)→ 不视为无序字符(可能是订单号)
   - 重复字符(如 `aaaaaaaa`)→ 不视为无序字符
   - 已知明文词(如 `example`、`test`、`demo`)→ 例外,不视为疑似密钥
2. **口令标志后的值**:`passwd:`/`password:`/`pwd:`/`password_hash`/`pass:`/`key:` 等标志后的值 → 脱敏
3. **关键词信号**:`token|basic|secret|password|api[_ -]?key|authorization|bearer|signing|credential|auth`(词边界,不区分大小写)
4. **强规则子集 + 内置高信号前缀**:BEARER_TOKEN/JWT/PROVIDER_API_KEY/GITHUB_TOKEN 等规则 + `sk-`/`eyJ`/`ghp_` 前缀直接命中即脱敏

**判定优先级**:窗口内任一疑似密钥信号命中 → 该窗口内所有 findings 保留。窗口大小 200 字符常量,实施时可调。

## 6. 兼容性与风险

| 风险 | 缓解 |
|---|---|
| 漏报:真秘密不在白名单窗口内 | 内置高信号前缀层(不可关)覆盖 sk-/eyJ/ghp_ 等强规则值;窗口内无序字符/口令标志/关键词/强规则四重检测 |
| 白名单配置错误导致真实资产不扫描 | 默认预置 ccload/gffunds;admin UI 提供预览按钮(输入样例文本 → 显示哪些值会被扫描) |
| 泛值通配 `*` 误匹配(如 `*xxx*` 过宽) | 文档标注通配语义;建议用户用最具体的模式 |
| 无序字符检测误伤(纯字母词/数字/重复字符) | 判定细则排除:纯字母单词、纯数字、重复字符、已知明文词不算疑似密钥 |
| 现有测试依赖 scanner_exclusions | 迁移到新配置;`npm test` 全绿 |
| 性能 | 窗口扫描天然 O(命中数×窗口);AC5 验证优于旧全文扫描 |
| admin 存量数据 | 旧 `scanner_exclusions` 行保留不删,避免破坏;新配置独立 init |

## 7. 与性能任务的合并

- 性能任务被吸收(D6):其基准基建(`benchmarks/` + `npm run bench`)直接复用,用于对比"旧全文扫描 vs 新窗口扫描"耗时。
- 批量扫描调研(maskJsonBody 逐值扫描)→ 窗口扫描天然规避(只扫窗口文本,不逐值全量)。
- CSV 证据(`research/audit-log-2026-08-06-analysis.md`)作为误报样本集 + 性能基线。

## 8. 测试策略

- `src/__tests__/high-risk-assets.test.ts`:通配匹配逻辑(domains/emails/accounts,`*` 语义;accounts 匹配登录账户名如 `wangxinleo`/`ft-*`,验证账户名命中定位其上下文窗口)
- `src/__tests__/context-window.test.ts`:
  - 窗口切片(±200 字符边界)
  - **无序 8+ 位字符检测**(`aB3x9K2mQwe7` 命中;`password`/`BasicFlow`/`12345678`/`aaaaaaaa`/`example` 不命中)
  - **口令标志后值检测**(`passwd:`/`password:`/`pwd:`/`password_hash` 标志后值脱敏)
  - 关键词/强规则/内置高信号前缀信号
  - 白名单外不扫描
- 集成:prose URL 不误报、真实 endpoint 脱敏、`sk-` 在窗口内脱敏、账户名 `wangxinleo` 邻近的密钥被脱敏
- 性能:bench 对比新旧扫描耗时
- 回归:`npm test` 全绿(scanner_exclusions 用例迁移)