# 扫描范式重构:高风险资产配置 + 上下文窗口扫描

## Goal

**扫描范式反转**:从"全文扫描 → 事后排除误报"改为 **"定位高风险资产 → 只扫描其上下文窗口"**。用户定义受保护的高风险资产白名单(域名/邮箱/帐户,支持 `*.xxx.xx` 泛值通配),扫描器只在这些白名单命中值周围的前后 200 字符窗口内检测强密钥信号,有信号才脱敏。**删除"扫描排除规则"功能,配置位改为"高风险值配置"。** 这一转变同时解决误报(prose URL/文档/commit sha 不在白名单 → 不扫描)与性能(扫描量从"全文×全管道"降到"白名单窗口×全管道")。

## 背景与证据

- 线上 audit CSV(`audit-log-2026-08-06.csv`):>340KB 请求几乎都命中 **13× CONTEXTUAL_SECRET + 1× BASIC_AUTH**,全部是误报(prose URL / commit sha / BasicFlow)。
- 根因锚点:
  - `isEndpointValue`(src/scanner/context-key.ts:311)对任何 URL 形状放行
  - `isHighEntropySecretValue`(src/scanner/context-key.ts:287)把 commit sha/UUID 误判为 secret
  - `BASIC_AUTH_RE`(src/scanner/secrets.ts:11)无边界约束
- 静态排除规则(scanner_exclusions)是**打地鼠**:只匹配整个 matched 值,URL 类误报每次不同,无法穷举;用户决定**删除该功能**,改为"高风险资产配置"。

## 决策记录(用户确认)

- D1: 扫描范式反转 = **定位高风险资产 → 只扫描其上下文窗口**(非全文扫描 + 事后过滤)。
- D2: 高风险资产配置 = **多分类白名单,支持泛值通配**:
  - 域名白名单:`*.ccload.com`、`*.gffunds.com`
  - 邮箱白名单:`*@*.ccload.com` 等
  - **账户白名单 = 登录账户名**(如 `wangxinleo`、`ft-*`),**不是 token/密钥配置**。账户名的作用是定位"用户身份出现的敏感区域"——账户名出现在哪里,其上下文窗口就是扫描区域。
- D7: **窗口内扫描要抓严**:在高风险值的上下文窗口内,任何疑似密钥的字符串都必须过滤,包括:
  - **无序 8+ 位字符**(非纯字母单词/非纯数字/非重复字符,含数字或符号或混合大小写)
  - **明显口令标志后的值**(`passwd:`/`password:`/`pwd:`/`password_hash` 等标志后的值)
  - 已知 token 模式(`sk-`/`eyJ`/`ghp_` 等)+ 关键词信号 + 强规则子集
- D3: 删除"扫描排除规则"(scanner_exclusions)功能,配置位改为"高风险值配置"。
- D4: 真实 endpoint(`*.ccload.com`/`*.gffunds.com`)与真实凭证(邻近强信号的 token)必须仍被脱敏。
- D5: 裁决/扫描必须**检测语义可验证**:不得引入漏报(真秘密必须仍被脱敏)。
- D6: **合并性能任务**:本任务升级为完整架构重构(白名单配置 + 窗口扫描 + 删除排除规则 + 性能基准);性能任务 `08-06-perf-investigation-large-payload-latency` 被吸收,其基准基建/CSV 证据/批量扫描调研并入本任务。

## Requirements

- R1: **高风险资产配置**(替代 scanner_exclusions):新增配置位,支持多分类白名单与泛值通配:
  - 域名白名单:`*.ccload.com`、`*.gffunds.com`
  - 邮箱白名单:`*@*.ccload.com`
  - 帐户白名单:`ft-*`、`*xxxx*`
  - 泛值通配语法:`*` 匹配任意字符序列
- R2: **上下文窗口扫描(抓严)**:对白名单命中值,取其前后 200 字符窗口,窗口内检测并过滤**任何疑似密钥**的字符串:
  - 无序 8+ 位字符(非纯字母/非纯数字/非重复,含数字/符号/混合大小写)
  - `passwd:`/`password:`/`pwd:`/`password_hash` 等口令标志后的值
  - `token`/`basic`/`secret`/`api_key`/`authorization`/`bearer`/`signing` 等关键词信号
  - STRONG_RULES 子集 + 内置高信号前缀(`sk-`/`eyJ`/`ghp_` 等)
- R3: **白名单区域外不扫描**:不在白名单的 URL/邮箱/账户(prose 文档、commit sha、BasicFlow)→ 不扫描、不产出 findings。
- R4: **内置高信号基础层不可关闭**:`sk-`/`eyJ`/`ghp_` 等强规则前缀即使不在白名单也在窗口内检测,防漏报。
- R5: 删除"扫描排除规则"(scanner_exclusions)功能及其 admin 配置位/文档/测试。
- R6: 真实 endpoint(`*.ccload.com`/`*.gffunds.com`)与真实凭证(邻近强信号的 token)必须仍被脱敏。
- R7: 保持向后兼容:现有测试中依赖 scanner_exclusions 的用例需迁移到新配置;`npm test` 全绿。

## Acceptance Criteria

- [x] AC1: 对 `audit-log-2026-08-06.csv` 中的误报样本(prose URL、commit sha、`BasicFlow`、`Basic dXNlcjpwYXNz`),新范式下不产出 findings(不在白名单 → 不扫描)。实测:prose URL/commit sha 在无白名单/无敏感键名时零 finding;`BasicFlow` 关键词信号需值信号配合,纯 prose 不误报。
- [x] AC2: 对真实 endpoint(`https://app.ccload.com/v1` 等,白名单内)与真实凭证(邻近强信号的 token),新范式下仍保留脱敏。实测:白名单域名命中 → 窗口扫描;`sk-`/`ghp_` 等全局高信号前缀层不可关闭。
- [x] AC3: 上下文窗口检测正确:同一 URL 出现在"白名单域名内"被扫描,出现在"白名单域名外"不扫描;白名单命中值邻近强信号时脱敏。实测:context-window.test.ts 覆盖。
- [x] AC4: 现有测试全部通过(`npm test`,357 tests / 28 files),无回归;scanner_exclusions 相关测试已迁移到新配置;新增 high-risk-assets/context-window 单元测试。
- [x] AC5: 性能显著提升:白名单窗口扫描对 278KB 负载的耗时低于旧全文扫描。实测:`npm run bench` → 1.60x(12.2ms vs 19.6ms)。
- [x] AC6: 删除 scanner_exclusions 功能(代码/配置位/admin UI/文档/测试),更新 reverse-proxy spec 扫描语义文档。实测:exclusions.ts 已删,配置位/UI/i18n/README 已迁移,spec 新增窗口扫描 Scenario。

## 实施中确认的决策(用户确认)

- PII(手机号/邮箱/身份证/银行卡)保留**全文扫描**:稳定格式、误报率低,与 secrets(prose URL/commit sha 误报)本质不同。
- `BASIC_AUTH` 从脱敏中排除:真实 basic 凭证按用户决策"不是我的秘密,不需要隐藏"(受白名单窗口上下文裁决约束)。
- 新增**敏感键名窗口层**(`locateSensitiveHits`):`api_key=`/`secret=`/`base_url=` 等键名本身是高信号,其窗口直接激活扫描,无需白名单命中。

## Out of Scope

- 不改变 STRONG_RULES 正则本身(避免漏报漂移);只改变"扫描范围"(白名单窗口)与"配置位"(排除规则→高风险值配置)。
- 不涉及性能优化本身(性能任务 08-06-perf-investigation-large-payload-latency 独立,但本任务的自然结果是性能提升)。
- 高风险值配置的泛值通配语法细节(如 `*` 语义、是否支持 `?`/字符类)留待实施时定;若需用户决策会回到此处。

## Open Questions

- (待实施)泛值通配语法细节、窗口大小(200 字符)是否可配置、强密钥信号关键词集合的精确清单。