# 扫描误报(误伤非敏感数据)治理需求评审

## Goal

评审扫描管线的误报(误伤非敏感数据)现状,用可执行验证(临时 Vitest 用例,已跑完即删)定位真实误报来源,产出有优先级排序的治理需求与验收标准。**本任务只做评审,不写实现代码**;实现作为独立后续任务。

## 背景

用户反馈"项目越来越难用,总是误伤敏感数据"。经全量代码走读 + 12 组假设验证(其中 5 组被证伪),确认以下**已实证**的误报/破坏场景。验证方法:临时 vitest 用例直接调用 `scanContextKey`/`scanPii`/`scanSecrets`/`maskJsonBody`,观察真实 findings 输出。

## 实证误报清单(按严重度排序)

### FP-1【P0·数据破坏】窗口内 base64 被当 BASE64_TOKEN 打码,破坏二进制/编码内容
- **复现**:`auth_token: "ghp_..."` 与任意 base64 blob(如 `eyJuYW1lIjoidGVzdCIs...`)同现 → blob 被整体替换为 `<<PRIVACY_MASK:BASE64_TOKEN>>`,**内容永久丢失**(C2b 验证 `blob intact: false`)。
- **根因**:json-mask.ts 的 `isBinaryPayload` 豁免只覆盖 data URI 和键名 `data` 的纯 base64;窗口扫描(context-window.ts:55)对窗内文本跑 `scanSecrets`,`BASE64_TOKEN_RE = /eyJ[A-Za-z0-9_-]{40,}/` 命中一切以 `eyJ` 开头的长 base64(即所有以 `{"` 开头的 JSON/文本编码内容)。
- **影响**:工具调用输出(文件内容、编码附件)在窗口锚点附近时被破坏,LLM 收到的是掩码而非内容 → "越来越难用"的直接来源之一。

### FP-2【P0·高频误伤】endpoint 键把正常内网地址当 CONTEXTUAL_SECRET
- **复现**:`{"server":"10.0.0.5:8080"}`、`{"host":"internal.corp.local"}` 均命中 CONTEXTUAL_SECRET(H2 验证)。
- **根因**:context-key.ts `isEndpointValue` 对裸 host/IP 形态返回 true,且 endpoint 值在 `hasSecretCandidate` 时被无条件并入 findings(context-key.ts:450-452)。
- **影响**:正常配置、接口文档、连接串示例全被打码。

### FP-3【P0·高频误伤】13 位毫秒时间戳被当手机号
- **复现**:`created_at=1756949100000` → PHONE `17569491000`(T1 验证,3 个不同时间戳全部命中)。
- **根因**:pii.ts `PHONE_RE = /(?<!\d)1[3-9]\d{9}/g` 的 lookbehind 只排除前导数字,13 位时间戳的前 11 位构成合法手机号形态。
- **影响**:日志、审计字段、API 响应里的时间戳是最高频数字串,几乎必然误伤。

### FP-4【P1·共现放大】identity 键(session/cookie)值在 secret 键共现时被连带打码
- **复现**:`api_password` + `session: "9f8e7d6c5b4a3210"` + `cookie: "SID=abcdef123456"` 同现 → session 值、cookie 值全部 CONTEXTUAL_SECRET(C1 验证)。
- **根因**:context-key.ts:450-452 `hasSecretCandidate` 时返回全部 endpoint/identity/encoded hits;identity 单独出现时是 CLEAN(H1 证伪了"identity 单独误报"的假设),共现才触发。
- **影响**:一个真实密码键会放大打码整个配置段。

### FP-5【P1·测试卡误报】Luhn 通过的 16 位数字(测试卡号/ID)被当 BANK_CARD
- **复现**:`4111111111111111`(业界标准测试卡)→ BANK_CARD(T2 验证)。
- **根因**:luhnCheck 只能证明"可能是卡号",无法区分测试卡/随机 ID。
- **影响**:低频但难排查;雪花 ID 等 19 位串已验证 CLEAN(20 位 run CLEAN),风险集中在恰好过 Luhn 的串。

### FP-6【P2·文档误伤】Bearer + 20 字符示例 token 在文档/教程文本中命中
- **复现**:`Bearer your-token-here-1234567890` → CLEAN(T4 证伪了"短横线示例必命中");但 `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example.signature` 形态的 JWT 示例仍会命中 JWT 规则(结构上无法与真 JWT 区分)。
- **影响**:中低频;治理空间有限,标注为已知限制。

## 已证伪的假设(避免后续任务走弯路)

- ❌ identity 键(session/ticket/cookie)单独出现即误报 → 实际有 `hasSecretCandidate` 门控,单独 CLEAN。
- ❌ configb64 无害配置解码即误报 → 解码后需含 secret 键=高熵值才命中,无害配置 CLEAN。
- ❌ `ENC(xxx)` 包装值在 identity 键上误报 → CLEAN(括号修复后仅 secret 键触发)。
- ❌ 20 位纯数字串(雪花 ID)被当 BANK_CARD → CLEAN。
- ❌ 独立 base64 blob(无锚点)被破坏 → 无窗口时 CLEAN;破坏仅在窗口锚点共现时发生(FP-1)。

## 漏报基线(治理不得恶化)

- `scanSecrets` 强格式规则(AKIA/sk-proj/ghp_)在**纯文本**下直接命中(F1b 验证),但**仅在窗口内运行**(context-window.ts:54):无锚点时 JSON 值里的真凭据会漏(F1/F3 CLEAN)。这是既有架构决策(性能换召回),治理误报时**不得进一步收窄**窗口触发条件。

## 治理方向(供实现任务参考,非本任务交付)

1. FP-1:BASE64_TOKEN 命中后先尝试 base64 解码,若解码结果是可打印文本/JSON 则**跳过打码**(或仅掩码解码后的真 secret);或窗口内对 `eyJ` 长串豁免。
2. FP-2:endpoint 值不再随 `hasSecretCandidate` 连带返回;或对私网 IP/`.local`/`.internal` 域名白名单化。
3. FP-3:PHONE_RE 加后缀边界 `(?!\d)`(13 位时间戳第 12 位是数字即排除);或对 13 位连续数字整体跳过手机号判定。
4. FP-4:identity 值打码需独立满足更高置信(如熵阈值),不随 secret 键共现自动升级。
5. FP-5:可配置测试卡号段(400000/411111 等)白名单;或 BANK_CARD 仅在金额/卡上下文词共现时启用。

## 验收标准(本评审任务)

- [x] 全量走读 src/scanner/ 7 个模块,梳理检测管线与决策流(pipeline/json-mask/context-window/context-key/secrets/pii/filename)。
- [x] ≥10 组假设用可执行用例验证,记录实证/证伪结论(12 组,5 组证伪)。
- [x] 产出按严重度排序的误报清单,每项含复现样例、根因代码位置、影响面。
- [x] 明确漏报基线约束(窗口架构不得收窄)。
- [x] 治理方向建议(5 条,供实现任务立项)。
- [ ] 用户确认优先级后,为 FP-1/FP-2/FP-3 创建独立实现子任务。

## 范围与约束

- 本任务不修改任何生产代码;验证用例已删除(git status 干净)。
- 治理实现须保持真凭据召回(AKIA/ghp_/sk-/私钥/真密码)不回退,以现有 secrets.test.ts / context-key.test.ts 全量回归为门禁。
- 实现任务须用真实负载样本(参考 08-12 任务的 `真实请求.md` 语料)验证误报下降,不以合成用例为唯一依据。
