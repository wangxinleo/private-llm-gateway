# 竞品更新复查（2026-09-23）

复查窗口：上轮调研截止（2026-09-21）→ 2026-09-23。方法：全量 clone 两个仓库 + `git log/diff` 级分析 + 我方代码对照 + 临时探针实测（探针已删除，工作区已恢复干净）。

## 1. 更新总览

| 仓库 | 上轮基线 | 当前 HEAD | 新增提交 | 结论 |
|---|---|---|---|---|
| xiaYuTian11/maskit（AGPL-3.0，仅借鉴设计） | v0.3.0（09-19） | 75787ba（09-22 10:17） | 12（v0.3.1/v0.3.2 发布类 3 + v0.4.0 修复类 3 + 发布后 6） | **有更新**，v0.4.0 |
| CassiopeiaCode/CosyRedactGateway（Apache-2.0） | 0e2be2e（09-18） | 0e2be2e（09-18） | 0 | **无更新**（GitHub updatedAt 09-22 系元数据刷新，pushed_at=09-18 11:03Z） |

Cosy：无新提交、无 tag/release、无新分支。上轮 T1（请求侧模型推理状态）即其最后一个提交，已借鉴完毕。

## 2. maskit v0.3.0 → HEAD 差异（12 提交）

拆分归属：
- **v0.3.1 / v0.3.2（3 提交）**：Docker 构建标签、CI 原生平台加速、桌面端扩展地址设置——发布/基建类，无引擎行为变化。
- **v0.4.0（3 提交，2a657cf 为 tag 点）**：`c7dc3ca`（09-21 09:04）、`06ef19e`（09-21 10:20）、`2a657cf`（09-21 20:22）——引擎/安全契约修复。
- **发布后（6 提交）**：release.ps1 容错、latest.json 摘要、扩展失联恢复、actions 升级、AGENTS.md 出库、注释清理——无引擎行为变化。

### 2.1 与我方相关的引擎差异（diff 级）

**M1. 响应 content-type 判定归一化**（`2a657cf`；新测试 `test_response_content_type_accepts_any_case`）
maskit 实测：上游回 `Text/Event-Stream`（或带空白）时，大小写敏感判据全落空 → 整段响应不还原，用户看到裸占位符。他们定为「响应侧唯一没做 lower() 的判据」并补测试。
**我方对照（探针实测，09-23）**：
- `src/app/[...path]/route.ts:129`、`:313` 均为 `contentType.includes("text/event-stream")`（大小写敏感），`route.ts:81-82` 的 `isBinaryContentType` 同样。
- 探针（mock 上游 + 永不结束的 SSE 流 + 含手机号请求触发 mask）：
  - `text/event-stream`（对照）→ 立即返回（流式）；
  - `Text/Event-Stream` → **响应挂起**（走缓冲路径 `await upstream.text()`，等整条流读完才返回；生产中=流式体验消失、长回答阻塞直到完成）；
  - ` text/event-stream ; charset=utf-8` → 立即返回（`includes` 对前导空白不敏感，非缺陷面）。
- 二进制对照探针（12B 触发 mask 的请求 + 上游二进制体）：
  - `application/octet-stream` → 字节原样（对照）；
  - `Application/Octet-Stream` → **响应体被 UTF-8 解码破坏**（12B → 18B，不可逆）。
结论：同一类缺陷在我方有 **两个真实触发面**（SSE 挂起 + 二进制损坏），高于 maskit 自身的影响面。→ 立项修复（T1）。

**M2. 响应侧体积闸 + 跳过留痕**（`2a657cf`；新测试 `test_oversized_json_response_skips_restore_but_leaves_a_trace`）
maskit：响应侧原先只受上游返回体大小间接限制；`json.loads + 全树遍历` 是同步 CPU，几十 MB 响应能把事件循环占住数秒、同进程所有会话停摆。处置：`_MAX_RESPONSE_RESTORE_BODY=32MB`（与请求侧对齐），超限**不改 body、跳过还原**，但必须 `_emit_skip(reason="response_too_large")` 留痕（否则用户看到裸占位符以为引擎坏了，事件页却无线索）。测试两条都钉：不得改 body + 必须留痕。
**我方对照**：请求侧有 32MB 闸（`route.ts:227/244` + 413），**响应侧完全没有**：`finalizeUpstream` 对非流式响应 `await upstream.text()`/`arrayBuffer()` 全文读入 + `restoreText` + `analyzeResponse` 全同步执行（`route.ts:151-164`），无任何上限与留痕。→ 立项修复（T2）。

**M3. 还原可观测性：unresolved/degraded 计数 + 样本 + 历史来源**（`c7dc3ca`）
maskit 真机教训三连（全部有实测数字）：
1. **计数面不能窄于检出面**：计数只认严格形态，`{{ EMAIL_x }}`（模型加空格）、`{{email_x}}`（标签小写）全漏 → 「页面满屏未还原，事件页只报 1」，用户质疑统计造假。
2. **转义遍会双计**：`_ESCAPED_PLACEHOLDER_RX` 的反斜杠量词 `\\{0,3}` 允许 0 个反斜杠 → 同一形态被两遍各计一次（3 个孤儿报成 6 个）；判据改为「整段里有没有反斜杠」。且只能在计数上排除、不能提前 return（提前 return 把 test_t7 打红——该还原的没还原）。
3. **无会话孤儿只数不还原**：会话不存在时若「补建会话」以便计数，等于拆掉安全门（全局复用表可被任意自造 sid 借用还原）；改用独立兜底表 `_count_orphans_without_session`（只计数、绝不还原，上限 256 条按最老淘汰）。
样本：`unresolved_samples` 上限 5（只存占位符本身，不含明文）；RESTORE 事件 items 补充**跨请求复用表还原项**（`from_history: true`；凭据类只给 digest+preview，不给 original）。
**我方对照**：
- `restore.ts:12-22` `restoreText` 只统计 `degraded`（宽松遍），**未命中占位符（unresolved）完全不计数**；`SseChannelRestorer.getDegraded()` 为死代码（无调用方）。
- 审计条目（`logger.ts` / `AuditEntry`）仅有请求侧 mask 字段（maskApplied/maskCategories/maskCount），**响应侧还原零可见**：还原了几个、几个没还原、什么形态，全部无处可查。
- 我方占位符为进程内 HMAC 确定性派生（同类值跨请求同 token），多轮场景下客户端重发原文会自然重注册；但「响应里出现当前 registry 查不到的 token」（如思考块/data 豁免面、客户端带入的历史 token）就是盲区。
→ 立项实现（T3）。

**M4. 错误诊断前缀**（`c7dc3ca`）
maskit 在 flow.error 的消息前加 `[err=<类型> resp=0|1 req=<字节>B ms=<时长>]`，区分「发请求时连接已死（典型=复用被上游关掉的空闲连接）」与「上游已开始回包、中途断开」——两者现象都是 connection closed 但修法不同，09-20 排查即卡在这里。
**我方对照**：`route.ts:403-412` catch 只记 `fetch_failed (code)` + debug detail；**流式响应中途中断完全静默**（`streaming.ts:71-73` 仅 `controller.error(err)`，无任何日志/审计）。→ 立项修复（T4）。

### 2.2 评估后不采纳 / 无动作

- **附件/文件内容脱敏（maskit 本版重点：OOXML 文本打码、`_pad_zip_to_size` 体积对齐、legacy Office 默认关、无命中绝不动文件、`file_size_mismatch` 拒收教训）**：我方 README「What it does not do」已明示「不解析上传文件内容、无 Office/PDF 解析」，且本体是 API 网关（web 端上传场景是 maskit 扩展链路的问题域）。**不立项**；如未来路线变更再评估（maskit 的教训可复用：重压缩会与声明体积漂移、无命中绝不改写、降级必须用户可见优于静默明文）。
- **扩展协议版本解耦（EXT_PROTOCOL_VERSION）/ 桥失联恢复（4 次无响应回退原生）/ XHR 还原收窄到 deepseek.com / 站点内置授权收窄为三站**：浏览器扩展问题域，我方无扩展。不适用。
- **`/api/ext/warn` 未支持形态上报（去重表严格有界、只收元数据不收正文）**：其**设计原则**与我方 T2/T3 的「跳过必须留痕、留痕不得含正文」同构，已并入 T2/T3 的验收标准；单独立项无对象。
- **OOXML 重压缩体积对齐**：我方不改写文件字节（multipart 文件原样），不适用。
- **对外能力表述收窄（README/CHANGELOG 中英对齐、默认开关写明、直通=不脱敏明示）**：我方 README「What it does / does not do」已具同款纪律（含 09-21 批次的 T7 非法 env 告警方向）；本轮无具体差异项，不立项。
- **release/CI/前端布局/注释清理**：基建与 UI 细节，无借鉴对象。

## 3. 立项映射（→ 子任务）

| # | 项 | 类型 | 优先级 | 我方证据 |
|---|---|---|---|---|
| T1 | 响应 content-type 判定归一化（SSE + 二进制） | 修复 | P0 | 探针实测：挂起 + 响应体损坏 |
| T2 | 响应体还原体积闸 + 跳过留痕 | 修复 | P1 | 代码对照：无任何上限与痕迹 |
| T3 | 响应还原可观测性（计数/样本/来源） | 实现 | P1 | 代码对照：零可见 + 死代码 |
| T4 | 上游/流式错误诊断增强 | 修复 | P2 | 代码对照：流式中断静默 |

（T1/T2/T4 走「先复现后修复」；T3 需 design 细化落库与 UI 载体。）
