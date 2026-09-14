# Maskit 功能差距评审与补充（隐私代理专注版）

## Goal

深度参考 [xiaYuTian11/maskit](https://github.com/xiaYuTian11/maskit)（数据面具，AGPL-3.0）的设计与近期演进，按**隐私代理本职**补充本项目能力：脱敏覆盖（词库/规则/PII）、响应侧安全分析、审计留存与引擎加固、流式还原协议正确性。

> **合规约束**：maskit 为 AGPL-3.0，**只借鉴设计思路，严禁复制代码**。
> **专注原则**（2026-09-14 用户确认）：只做与隐私代理有关的事情；代理基础设施（多渠道）与经营统计（token 用量/费用）一律不做。

## Background

- 本项目：Next.js 本地脱敏网关（请求侧扫描脱敏 + 响应侧还原 + SQLite 审计 + Dashboard）。
- maskit：Python/mitmproxy 透明代理 + Tauri 桌面壳；本轮调研覆盖其 README/config.example.json/引擎源码 + **2026-09-11~13 的 50 个提交**（6 个关键提交 diff 级分析）。
- 前序借鉴已落地：占位符随机辅音后缀、SSE 事件层通道化还原、宽松修复、防套娃、分段保护（`.trellis/tasks/archive/2026-09/09-10-downstream-restore/`）。

## Confirmed Facts — 我方现状（2026-09-11 勘察）

- 转发：catch-all `/api/*` → 单一 `UPSTREAM_URL`（`src/proxy/forwarder.ts:8`）；主流程 `route.ts:120-283`：extractPath → bypass → maskJsonBody/runPipeline → forwardRequest → finalizeUpstream。
- 扫描：pipeline 文件名 block 短路→窗口扫描→allow/mask（`src/scanner/pipeline.ts:17-76`）；Secrets 30+ 正则（`secrets.ts:7-92`）；PII 仅手机/Email/身份证/银行卡（`pii.ts:7-53`）；规则全硬编码，仅白名单资产可配；请求侧扫描，响应侧只还原。
- 还原：SSE 通道化（`src/proxy/restore.ts:29-158`），**通道键 = JSON 路径（数组用位置索引）**，仅流尾全局 flush；终态事件无通道级处理。
- 审计：audit_log/system_config/bypass_rules（`store.ts:12-33`）；无自动留存；maskApplied 等构造未落库（`logger.ts:46-51` vs `store.ts:52-55`）；reveal 二次鉴权；管理端仅 x-admin-key（`admin-auth.ts:3-13`），无 Origin 校验。
- Dashboard：Overview/Audit/Rules/Settings 4 页，中英 i18n、暗色（`dashboard-shell.tsx`）。
- 配置：SQLite 热加载基建 loadOrInit/refreshConfig（`config-loader.ts:18-49,52-81`）；npm scripts：build/test(vitest)/bench。

## Confirmed Facts — maskit 功能面与近 3 天教训

### 全功能面（调研基准）
- 19 类内置规则逐项开关 + 独立校验函数压误报（Luhn/ISO7064/JWT 解码/IBAN mod-97/USCC 排除字/MAC 分隔符反引/IP 防截半）。
- 自定义词库 Words 页：分类、组/词级禁用、单字词 CJK+字母数字双侧边界、`re:` 正则（非法跳过防 503）、整词开关、合并单正则+缓存；.env 一键导入。
- 被动审计 7 信号 + severity LOW→CRITICAL + severity_floor（默认 MEDIUM）；response_scan：restore 后重扫规则，命中不在本请求映射的 PII → 只记录。
- log_retention_days 默认 7（≤0 永久）；fail_closed 默认开（脱敏异常 503、>32MB 413）；Origin 校验默认开 + TRUST_PROXY。
- 流式：按 JSON 路径分通道缓冲半截占位符（与我方同构）。

### 近 3 天（09-11~13）教训批次（diff 级核实）
1. **通道键必须语义索引**（#25/433c07c）：稀疏分片 `choices[].index` ≠ 数组位置时跨 choice 污染；仅按位置建通道不可靠。
2. **扁平事件信封共享通道**（56e5a32 `_sse_response_channel`）：Responses 的 `content` 可为多 part 数组，`content_index` 缺失时省略该段保持键形兼容；刻意不用 item_id（部分中转缺失会致 .done 清理失配）。
3. **Responses `.done` 快照清 pending**（0bc1ea7）：快照整树替换后必须 pop 该通道 pending/flush_tmpl，否则流尾补发造成重复文本。命中我方同类缺陷（我方 `delta` 路径通道 + 流尾全局 flush）。
4. **终态事件通道级 flush**（433c07c）：`content_block_stop`→flush 该块、`finish_reason`→flush 该 choice、`.done`→清该通道；其余通道继续缓冲；模板用于 escape 判定。
5. **短 Key 漏脱敏**（a5f5a47）：前缀正则最小长度 19 位 → 8~16 位自建短 Key 全漏；修正为前缀+≥8 位密文（避开 sk-demo 等误伤）。
6. **等长换词缓存失效**（a5f5a47）：词表缓存只比长度不比内容 → 热更新不生效；改为按内容比较/显式重建。
7. **fail_closed 白名单穿洞**（56e5a32，外部审计 SHIELD-UNLISTED-PASSTHROUGH-001）：路径白名单追不上新协议（Cohere/Bedrock 曾整包透传明文）→ fail_closed 承诺不得依赖路径白名单，未知形状必须进主管线。我方 catch-all 全扫结构上免疫，需测试锁定。
8. **请求头红线**（8adbd8a）：改写请求头占位符/凭据头注入覆盖真 Key → 401。教训：绝不改写请求头。
9. `.env 一键导入`（30a0155）：粘贴 .env 内容批量导入敏感词。
10. 评估后不采纳：字节级 splice 前缀保真（上游 prompt cache 优化，非隐私本职，记 backlog）；usage 采集（随 R4 砍除）。

## Scope Decision（2026-09-14 用户确认）

**纳入**：R1 词库（含 .env 导入）、R2 规则开关+PII 扩充+短 Key 修正、R3 响应侧分析、R4 留存 TTL、R5 fail_closed/32MB 加固、R6 Origin 校验、R7 流式还原协议硬化（新增，隐私正确性核心修复）。
**剔除**：~~Token 用量统计~~（用户指示）、~~多渠道上游 G3~~（代理基础设施非隐私能力，另立后续任务）、价格/费用、主动探针、导出、egress 代理、字节级 splice、G7 会话复用（另议）。

## Requirements

### R1 自定义词库（G1）
- R1.1 SQLite 新表 `custom_words`：id、label（分类）、value、kind（word|regex）、whole_word（bool，仅 word）、enabled（bool）、created_at。
- R1.2 扫描管线新增词库阶段：word 全文匹配——单字词自动 CJK+字母数字双侧边界，≥2 字按子串匹配（IGNORECASE）；whole_word=true 加整词边界；regex 条目逐条编译，非法跳过并告警（不得 503）；**合并单正则 + 缓存按内容版本失效**（教训 6：不得只比长度），词库变更热加载。
- R1.3 命中进脱敏与 registry：分类名 safe-label 化（大写、剔非 [A-Z0-9]、截 12、空回退 TERM）作占位符短码；不改占位符格式与随机辅音后缀规范。
- R1.4 管理面：`/api/admin/words` CRUD + Dashboard 新增 Words 页（分类分组、单条启停、整词开关、word/regex 增删改、非法正则校验提示）。
- R1.5 `.env 粘贴导入`（教训 9）：Words 页粘贴 .env 文本 → 解析 `KEY=VALUE` 取 VALUE 侧作为词条批量导入（可预览勾选）；空值/注释行跳过。
- R1.6 词库命中默认 mask（不引入新 block 语义）；全链路（JSON 嵌套/multipart/disambiguation 交互）穿透测试（教训：maskit「词条穿透链路闭环」批次）。

### R2 内置规则开关 + PII 扩充 + 短 Key 修正（G2+教训 5）
- R2.1 内置规则逐项开关存 SQLite（JSON），Settings 页清单+启停，热加载；关闭类别不出 findings；保存语义逐条独立（教训：maskit 排队保存互相覆盖）。
- R2.2 PII 新增 8 类（各带校验函数）：LANDLINE（区号+7-8 位+分机复核）、PLATE（含数字强制）、IP_PRIVATE（192.168/169.254/100.64-127，默认开）、IP_INTERNAL（10.x/172.16-31，默认关）、IBAN（mod-97）、USCC（排除 I/O/S/V/Z）、MAC（分隔符一致）、HKID（默认关）。
- R2.3 `secret_prefixes` 可配置（JSON 数组，默认 `["sk-"]`）；**前缀密文最小长度设 8 位**（教训 5），并复核 secrets.ts 现有前缀正则（sk-/ghp_/AKIA 等）最小长度，过长者下调至 8 并补短样例测试。
- R2.4 不引入未经验证的豁免（exemption）启发式；若未来需要，必须有正负样例锁定（教训：maskit EMAIL 避让放过真实邮箱、CONNSTR 豁免被占位主机误判）。

### R3 响应侧分析（G4+G5 合并）
- R3.1 统一响应分析 pass：restore 后文本（非流式=全文；流式=逐事件累积），异常绝不中断响应转发；分析窗口默认前 2MB 截断。
- R3.2 response_scan：重跑内置规则+词库，命中值不在本请求 fwd 映射（模型自产 PII）→ SCAN_WARN 只记录；detail 只存类别+打码 preview（**不落完整敏感值**）。
- R3.3 被动信号 5 项：error_leak（status≥400 扫 secret 正则+高熵检测）、identity_swap（响应 model vs 请求 model 首段家族比对）、response_poison（零宽字符≥阈值/双向覆盖符/凭据回流——还原回声抑制）、sse_anomaly（解析失败帧率/未知事件统计）、dangerous_action（危险命令结构正则，LOW 只记不拦）。
- R3.4 severity LOW/MEDIUM/HIGH/CRITICAL；`audit_severity_floor`（默认 MEDIUM）过滤落库；全部只记录不阻断。
- R3.5 新表 `audit_signals`（id、ts、audit_id、signal、severity、detail JSON）；Audit 页行展开信号区 + Overview 信号计数卡。
- R3.6 bypass/legacy（restore 关闭）链路不做响应分析，保持透传。

### R4 审计自动留存（G8）
- R4.1 `log_retention_days`（默认 7，0=永久），Settings 页可改（输入防呆：非负整数）。
- R4.2 启动 + 每小时清理 audit_log 与 audit_signals；daily 聚合表保留；清理量记日志。

### R5 引擎加固（G9+教训 7）
- R5.1 请求体上限默认 32MB → 413（`MAX_BODY_MB` 可配）。
- R5.2 `fail_closed`（默认开）：扫描/脱敏异常 → 503 mask_failed；关闭 → 放行原文记 ERR。实现前核实 pipeline.ts 现有 catch 语义，避免双重 fail-open。
- R5.3 测试锁定「未知形状必扫」：任意 JSON（键不认识/新协议形状）与非 JSON 文本均进扫描管线，fail_closed 下不得因形状未知而放行（教训 7）。

### R6 管理面 Origin 校验（G10）
- R6.1 `/api/admin/*` Origin/Referer 校验：同源放行；`ALLOWED_ORIGINS` 配置额外来源；`TRUST_PROXY=1` 信任 X-Forwarded-Proto。
- R6.2 失败 403；`DISABLE_ORIGIN_CHECK=1` 逃生舱；x-admin-key 仍为主防线。

### R7 流式还原协议硬化（新增，近 3 天教训 1-4）
- R7.1 **语义通道键**：OpenAI chat `choices[]` 通道键用 `choice.index`（缺失回退数组位置，教训 1）；Anthropic 用根级块 `index` + delta 类型（text_delta→text、input_json_delta→json）；Responses 用 `output_index` + `content_index`（缺失或 0 时省略段，教训 2）+ 事件类型推导 kind；未知形状回退现 JSON 路径方案。
- R7.2 **终态通道级 flush**：`message_stop/message_delta`、`response.completed/incomplete/failed` flush 全部；`content_block_stop` flush 该块；`choices[].finish_reason` flush 该 choice；其余通道继续缓冲（教训 4）。
- R7.3 **Responses `.done` 快照**：`response.output_text.done`/`reasoning_text.done`/`function_call_arguments.done` 整树还原后 pop 该通道 pending 与 flush 模板，不得再补发 delta（教训 3）。
- R7.4 异常健壮性：单通道 flush/restore 异常不丢其他通道已扣留文本；还原路径正则回溯审计（STICKY/有界），加 restore 基准测试（npm run bench）。
- R7.5 全部行为测试锁定：chat 多 choice 稀疏 index、Anthropic 双块交错、Responses 多 part + `.done`、finish_reason 中途到达、解析失败帧透传、流尾残留 flush、degraded 计数。

### R8 控制台一致性
- R8.1 新增 Words 页与全部新设置项纳入中英 i18n 与暗色；侧栏更新；现有 4 页不回归。

## Acceptance Criteria

- [ ] AC1（R1）：Words 页增删改查可用；单字中文词邻接不误伤；非法正则保存被拦截、存量非法正则不 503；命中→`{{LABEL_辅音}}`→响应还原；停用立即生效；.env 粘贴导入批量入库；等长换词后缓存立即失效（新词命中/旧词不再命中）；JSON 嵌套与 multipart 链路穿透。
- [ ] AC2（R2）：Settings 逐项开关生效；8 新类别正负样例通过（10.2.3.4 版本号不触发 IP_INTERNAL、无数字车牌不命中、USCC 排除字、MAC 混分隔符、IBAN 校验和、身份证/银行卡回归）；`sk-abc12345`（8 位短 Key）命中、`sk-demo` 类极短值不误伤；自定义 prefix 生效。
- [ ] AC3（R3）：4xx 响应含 sk- 密钥 → error_leak 落库；零宽字符 → response_poison；响应出现请求外新手机号 → SCAN_WARN（detail 无完整原文）；危险命令 → dangerous_action(LOW)；均不阻断、不影响还原。
- [ ] AC4（R4）：retention=7 清理 7 天前记录、0 不清；启动与周期路径均触发；输入防呆。
- [ ] AC5（R5）：>32MB → 413；故障注入下 fail_closed=on 503 / off 放行；未知形状 JSON（如 `{"text":"张三 138…"}` 新协议形态）被扫描脱敏。
- [ ] AC6（R6）：跨源 admin 请求 403；同源与 ALLOWED_ORIGINS 放行；逃生舱生效。
- [ ] AC7（R7）：多 choice 稀疏 index 分片各自还原不串号；Anthropic 两块交错不串号；Responses 多 part + `.done` 后无重复 delta、残留被清；finish_reason 中途 flush 正确；解析失败帧原样透传；现有还原测试全绿。
- [ ] AC8（R8）：新页面中英/暗色齐全；`npm run build`、lint、`npm run test` 全绿；手工回归脱敏→还原→审计主链路。

## Out of Scope

- Token 用量/费用统计（用户指示剔除）；多渠道上游 G3（另立任务）；价格表/price_sync；主动探针/auto_report；审计导出；egress 二级代理；字节级 splice 前缀保真（backlog）；stream_exclude_hosts；G7 会话占位符复用（另议）；Tauri 桌面壳。

## Open Questions

（无阻塞项。G7、G3 后续各自单独立任务。）
