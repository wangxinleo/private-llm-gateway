# 实施计划:扫描范式重构 — 高风险资产配置 + 上下文窗口扫描

## 执行清单(顺序执行)

### Phase A:配置模型与数据层

- [ ] A1. `src/types.ts`:删除 `ExclusionRule`,新增 `HighRiskAssets`(domains/emails/accounts 数组);`EditableConfigValue` 更新
- [ ] A2. `src/config.ts`:删除 `SCANNER_EXCLUSIONS`/`DEFAULT_EXCLUSION_RULES`;新增 `HIGH_RISK_ASSETS` 状态容器 + 默认值(`*.ccload.com`/`*.gffunds.com`)
- [ ] A3. `src/config-loader.ts`:删除 `scanner_exclusions` 加载(43-44)与 refreshConfig 分支(79-82);新增 `high_risk_assets` 加载与 refresh
- [ ] A4. 验证:`npm test` 全绿(scanner_exclusions 相关用例暂标记待迁移)

### Phase B:通配匹配 + 窗口扫描核心

- [ ] B1. 新建 `src/scanner/high-risk-assets.ts`:
  - [ ] `globToRegExp(pattern)`:泛值通配 `*` → 正则(转义其余字符,`*` → `.*`)
  - [ ] `matchDomains(text, domains)`:提取 URL host 匹配
  - [ ] `matchEmails(text, emails)`:提取邮箱匹配
  - [ ] `matchAccounts(text, accounts)`:上下文 key 值 + 强规则值匹配
  - [ ] `locateHighRiskAssets(text, config)`:返回 `{ value, start, end }[]`
- [ ] B2. 新建 `src/scanner/context-window.ts`:
  - [ ] `CONTEXT_WINDOW = 200`
  - [ ] `hasStrongSecretSignal(window)`(D7 抓严,四重信号任一命中即真):
    - [ ] 无序 8+ 位字符:`[A-Za-z0-9_\-]{8,}` 且非纯字母单词/非纯数字/非重复字符,含数字或符号或混合大小写
    - [ ] 口令标志后值:`passwd:`/`password:`/`pwd:`/`password_hash`/`pass:`/`key:` 标志后的值
    - [ ] 关键词信号:token/basic/secret/password/api_key/authorization/bearer/signing/credential/auth(词边界)
    - [ ] 强规则子集 + 内置高信号前缀:BEARER_TOKEN/JWT/PROVIDER_API_KEY/GITHUB_TOKEN 等 + `sk-`/`eyJ`/`ghp_` 前缀
    - [ ] 判定细则防误伤:纯字母单词(`password`/`BasicFlow`)、纯数字、重复字符、`example`/`test`/`demo` 不算疑似密钥
  - [ ] `scanContextWindows(assets, text)`:切片窗口 → 全管道扫描 → 产出 findings
- [ ] B3. `src/scanner/pipeline.ts`:runPipeline 改为调用 locateHighRiskAssets + scanContextWindows(替代全文扫描)
- [ ] B4. 验证:手动跑 `npm test` 确认无崩溃

### Phase C:admin UI 与配置面

- [ ] C1. admin config API(`src/app/api/admin/config/route.ts`):`scanner_exclusions` → `high_risk_assets`
- [ ] C2. Settings 页(前端):"Scanner exclusion rules" → "High-risk assets"(域名/邮箱/帐户三栏)
- [ ] C3. 删除/迁移 scanner_exclusions 相关测试到新配置
- [ ] C4. 验证:admin 页面可读写 high_risk_assets,存量 scanner_exclusions 行不受影响

### Phase D:性能基准(合并性能任务)

- [ ] D1. 从性能任务迁入基准基建:`benchmarks/` + `npm run bench`(若性能任务已有)
- [ ] D2. 基准对比:旧全文扫描 vs 新窗口扫描(278KB 负载,误报样本集)
- [ ] D3. 记录耗时对比到 `research/`

### Phase E:测试与收尾

- [ ] E1. `src/__tests__/high-risk-assets.test.ts`:通配匹配 + 三分类定位
- [ ] E2. `src/__tests__/context-window.test.ts`:窗口切片、强信号、白名单外不扫描;D7 用例:
  - [ ] 无序 8+ 位字符命中:`aB3x9K2mQwe7`/`wx456_klm` → 脱敏
  - [ ] 非疑似:`password`/`BasicFlow`/`12345678`/`aaaaaaaa`/`example`/`test`/`demo` → 不脱敏
  - [ ] 口令标志后值:`passwd: xyz123!`/`PASSWORD=abcDEF9` → 脱敏
  - [ ] 窗口边界外不误报:白名单命中值 ±200 字符外的疑似文本不扫描
- [ ] E3. 集成测试:prose URL 不误报 / 真实 endpoint 脱敏 / `sk-` 窗口内脱敏
- [ ] E4. `npm test` 全绿 + `npx tsc --noEmit` + `npm run build`
- [ ] E5. 更新 reverse-proxy spec 扫描语义文档(删除 scanner_exclusions,新增 high_risk_assets)
- [ ] E6. 更新 PRD 勾选 AC1-AC6

## 验证命令

```bash
npm test          # 单元测试 + 回归
npx tsc --noEmit  # 类型检查
npm run build     # 构建验证
npm run bench     # 性能对比(合并后)
```

## 风险文件与回滚点

- 触碰:`src/types.ts`、`src/config.ts`、`src/config-loader.ts`、`src/scanner/pipeline.ts`、admin config API、Settings 页
- 新增:`src/scanner/high-risk-assets.ts`、`src/scanner/context-window.ts`、两个测试文件
- 回滚:pipeline.ts 中 runPipeline 改回全文扫描调用点即可;配置层新增是独立的,删除即回滚
- 存量数据:旧 `scanner_exclusions` 行保留不删,避免破坏

## 前置检查

- `task.py start` 前:PRD 已含 D1-D7、AC1-AC6、设计已就绪
- 若发现通配语法/窗口大小/强信号清单需用户决策,回到 Phase 1 修订 PRD