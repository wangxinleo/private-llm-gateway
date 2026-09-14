# Implement — Maskit 功能差距补充（隐私代理专注版）

> 顺序执行 P1→P6；每阶段独立可交付、可回滚（阶段收尾 commit）。实现前读 design.md 对应节与 prd.md R 条款；写码前过 `trellis-before-dev`。

## 验证命令

```bash
npm run build          # 类型+构建
npm run test           # vitest
npm run bench          # 还原/扫描基准
npm run dev            # 手工 golden path：脱敏→SSE/非流式还原→审计
```

## P1 基建：schema + 开关 + 留存 + 加固（R4/R5）

- [x] `src/audit/store.ts`：新表 custom_words / audit_signals；audit_log 幂等加列 mask_applied/mask_categories/mask_count（PRAGMA table_info 检查）。
- [x] `src/audit/logger.ts`：maskApplied/maskCategories/maskCount 落库。
- [x] `src/config.ts` + `src/config-loader.ts`：rule_toggles / secret_prefixes / secret_prefix_min_length / log_retention_days / audit_severity_floor / fail_closed / max_body_mb + refreshConfig 分支；admin config API 逐 key 独立保存。
- [x] `src/audit/retention.ts`：pruneExpired（audit_log + audit_signals），启动 + setInterval 1h（unref）。
- [x] `route.ts`：body 上限 413（content-length + 实读双检）；pipeline 调用点 try/catch → fail_closed 503 / fail-open 放行（**先核实 pipeline.ts:17-76 既有 catch，避免双重 fail-open**）。
- [x] 单测：retention 边界（0=永久）、413、fail_closed 两态、未知形状 JSON 必扫（`{"text":"张三 138…"}` 断言 findings 非空）。

## P2 内置规则开关 + PII 扩充 + 短 Key 修正（R2）

- [x] `src/scanner/pii.ts`：LANDLINE/PLATE/IP_PRIVATE/IP_INTERNAL/IBAN/USCC/MAC/HKID detector + 校验函数；Category 枚举扩充。
- [x] `src/scanner/pipeline.ts`：各 stage 按 SCANNER_RULES 短路；secret_prefixes + min_length → SECRET finding。
- [x] `src/scanner/secrets.ts`：复核既有前缀正则最小长度（sk-/ghp_/AKIA 等），过长者下调至 8 并补短样例。
- [x] Settings 页：规则开关清单（分组）+ secret_prefixes 编辑，逐项独立保存。
- [x] 单测（AC2 清单）：10.2.3.4 不触发 IP_INTERNAL、无数字车牌、USCC 排除字、MAC 混分隔符、IBAN mod-97、`sk-abc12345` 命中、`sk-demo` 不误伤、身份证/银行卡回归。

## P3 自定义词库（R1）

- [x] `src/words/store.ts`：CRUD + bulk + listAll + contentVersion 自增。
- [x] `src/scanner/custom-words.ts`：合并正则缓存（CJK 感知边界、单字词强制边界、regex 非法跳过），缓存按 contentVersion 失效。
- [x] `src/scanner/mask-registry.ts`：短码白名单放开为 `^[A-Z0-9_]{1,12}$`（防套娃/分段保护测试必须绿）。
- [x] `pipeline.ts` 接入词库阶段（窗口扫描后）。
- [x] `/api/admin/words` CRUD + bulk（label 非空、value 非空、regex 预编译校验）。
- [x] `/dashboard/words` 页（分组、启停、整词、word/regex、非法正则提示、.env 粘贴导入 dialog）+ i18n + 侧栏。
- [x] 单测：单字词邻接不误伤、整词边界、非法正则不 503、命中→`{{LABEL_辅音}}`→还原往返、**等长换词缓存立即失效**、JSON 嵌套/multipart 穿透。

## P4 流式还原协议硬化（R7）

- [x] 新 `src/proxy/restore-channels.ts`：resolveChannelKey（chat choice.index / Anthropic 块 index+delta 类型 / Responses output_index+content_index+kind）+ terminalChannels + .done 快照映射；判定不出 → null（回退 JSON 路径）。
- [x] `src/proxy/restore.ts`：语义键接入 restoreDeep/restoreChannel；终态通道级 flush（匹配前缀才补发）；`.done` 快照还原后 pop pending+flush 模板；flush 单通道 try/catch。
- [x] `npm run bench`：新增 restore 基准用例（长流多通道 + 残留 flush）。
- [x] 单测（design §5.5 矩阵）：chat 稀疏 index 交错、单 choice index=2 位置=0、Anthropic 双块交错 + content_block_stop 局部 flush、Responses 多 part + `.done` 无补发、finish_reason 中途 flush、解析失败帧透传、未知形状回退、既有还原回归全绿。

## P5 响应侧分析（R3）

- [x] 新 `src/proxy/response-analysis.ts`：analyzeResponse（SCAN_WARN / error_leak / identity_swap / response_poison / dangerous_action，永不 throw，2MB 截断，detail 只存类别+打码 preview）。
- [x] `src/audit/signals-store.ts`：insert 批量 + severity_floor 过滤 + query。
- [x] 非流式接入：finalizeUpstream restore 后分析；流式接入：restore 侧累积文本统计（sse_anomaly）；bypass/legacy 不接。
- [x] `/api/admin/signals` 查询；Audit 页行展开 signals 区块 + Overview 信号计数卡 + i18n。
- [x] 单测：还原回声抑制、模型自产 PII → SCAN_WARN（detail 无完整原文）、4xx 泄漏 → CRITICAL、异常注入不中断响应、severity_floor 过滤。

## P6 Origin 校验 + 全量回归（R6/AC8）

- [x] 新 `src/middleware.ts`：/api/admin/* Origin/Referer 校验、ALLOWED_ORIGINS、TRUST_PROXY、DISABLE_ORIGIN_CHECK。
- [x] 单测：跨源 403、同源放行、配置来源放行、逃生舱。
- [x] 全量：`npm run build && npm run test && npm run bench`；手工 golden path（请求脱敏→SSE/非流式还原→审计→reveal）；dashboard 全页中英/暗色。
- [x] `trellis-check` 质量门禁。

## 风险文件与回滚点

| 文件 | 风险 | 回滚 |
|---|---|---|
| `src/proxy/restore.ts` + 新 restore-channels.ts | 流式还原核心改动 | P4 独立成阶段，测试矩阵全绿才合入；回退=移除语义键分支（fallbackPath 即现行为） |
| `src/app/api/[[...path]]/route.ts` | 主链路（413/fail_closed/分析接入） | 每阶段末 commit；P1/P5 后手工回归 |
| `src/audit/store.ts` | migration 幂等性 | 只加表/加列，回退代码即可 |
| `src/scanner/mask-registry.ts` | 短码白名单放开影响防套娃 | P3 保留既有防套娃/分段保护测试绿 |
| `src/scanner/secrets.ts` | 短 Key 下调可能引入误报 | 每条正则独立样例测试；过严可回调 min_length 配置 |

## task.py start 前检查

- [x] prd.md / design.md / implement.md 用户已确认
- [x] 每阶段按 trellis-before-dev 读 spec（backend/frontend 层）

## 实施记录与纠偏(2026-09-14 全部完成)

| 纠偏/发现 | 处置 |
|---|---|
| 内置厂商前缀正则(sk-/ghp_/AKIA 等)最小长度未下调 | 与 design 偏差:厂商格式定长,压误报优先;短 Key 覆盖交给可配置 secret_prefixes(默认 8 位),AC2 语义满足 |
| 词库边界语义偏离 maskit | maskit 对 CJK+字母数字双侧设界会使单字/整词在连续中文里永不命中;改为仅字母数字设界,CJK 邻接放行(privacy-first),测试注释已声明 |
| 现存缺陷:Anthropic/Responses 带 event: 行的 SSE 帧此前整帧不还原 | P4 顺带修复(按 SSE 规范抽取 data 行) |
| 现存缺陷:扁平事件信封(根级 delta)全块共享通道 | P4 语义通道键修复 |
| 已知噪声:disambiguation notice 的示例占位符({{EMAIL_trwmq}})会触发 placeholder_residual MEDIUM | 信号语义为真(占位符确实到达客户端);暂不豁免,观察误报率再定 |
| 审计 GET 未透出 mask_* 列(桌面验证发现) | 已补映射并修断言 |

**验证**:471 vitest 全绿 + build 绿 + 桌面验证(浏览器实测 Overview 信号卡/Words CRUD/Settings 35 开关/Audit 行展开信号/EN+暗色;curl 实测流式分片还原、热加载双向闭环、4xx 泄漏→CRITICAL 信号)。
