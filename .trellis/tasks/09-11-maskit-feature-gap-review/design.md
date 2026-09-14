# Design — Maskit 功能差距补充（隐私代理专注版）

> 对应 prd.md R1-R8。原则：复用现有基建（config-loader 热加载、MaskRegistry、SSE 通道化还原、SQLite store），不引运行时依赖，不破坏现有转发/还原/审计语义。多渠道（G3）与用量统计（R4 旧）已剔除，另立任务。

## 1. 数据层（`src/audit/store.ts` + migration）

新表（启动时 `CREATE TABLE IF NOT EXISTS`，集中 store.ts）：

```sql
custom_words(id INTEGER PK, label TEXT NOT NULL, value TEXT NOT NULL,
             kind TEXT CHECK(kind IN ('word','regex')), whole_word INTEGER DEFAULT 0,
             enabled INTEGER DEFAULT 1, created_at TEXT)
audit_signals(id INTEGER PK, ts TEXT, audit_id INTEGER, signal TEXT,
              severity TEXT CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
              detail TEXT)          -- JSON
```

audit_log 列扩展（migration：`PRAGMA table_info` 检查后 `ALTER TABLE ADD COLUMN`，幂等，只加不改）：`mask_applied INTEGER`、`mask_categories TEXT`、`mask_count INTEGER`（顺手修复 logger 构造未落库的现存缺陷）。

新 store 模块：`src/words/store.ts`（CRUD + listAll + contentVersion）、`src/audit/signals-store.ts`（insert 批量 + query + prune）。

## 2. 配置与热加载（`src/config.ts` + `src/config-loader.ts`）

沿用 loadOrInit/refreshConfig 模式新增：

| key | 类型 | 默认 |
|---|---|---|
| `rule_toggles` | json | 全类 true（IP_INTERNAL/HKID/USCC/MAC false，对齐 maskit 预设） |
| `secret_prefixes` | json | `["sk-"]` |
| `secret_prefix_min_length` | number | 8 |
| `log_retention_days` | number | 7 |
| `audit_severity_floor` | text | MEDIUM |
| `fail_closed` | text "1"/"0" | "1" |
| `max_body_mb` | number | 32 |

运行时结构 `SCANNER_RULES: Record<Category, boolean>` 与 `RUNTIME: { failClosed, maxBodyBytes, logRetentionDays, severityFloor, secretPrefixes, secretPrefixMinLen }`。保存接口逐 key 独立提交（教训：maskit 排队保存互相覆盖）。

## 3. 扫描管线（R1/R2）

### 3.1 PII 扩充（`src/scanner/pii.ts`）

新增 8 类 detector，全部「正则粗筛 + 校验函数复核」（自己实现，对齐思路）：

- LANDLINE：`0\d{2,3}-?\d{7,8}(-\d{1,4})?` + 区号/本地号复核。
- PLATE：省份字+字母+5-6 位车身，强制含数字（前瞻）。
- IP_PRIVATE / IP_INTERNAL：私有段正则 + 边界防五段截半；开关独立。
- IBAN：`[A-Z]{2}\d{2}[A-Z0-9]{11,30}` + mod-97。
- USCC：18 位字符集排除 I/O/S/V/Z。
- MAC：分隔符反向引用一致。
- HKID：`[A-Z]{1,2}\d{6}\(?[0-9A]\)?`（默认关）。

类别枚举扩充；`pipeline.ts` 各 stage 查 `SCANNER_RULES[category]` 短路。`secret_prefixes`：`(?<![A-Za-z0-9_-])(?:prefixes)[A-Za-z0-9][A-Za-z0-9_-]{minLen-1,}(?![A-Za-z0-9_-])`（minLen 默认 8，教训 5）→ SECRET finding；同时下调 secrets.ts 现有过长前缀正则。

### 3.2 词库阶段（新 `src/scanner/custom-words.ts`）

- `compileWordsCache()`：listAll(enabled) → word 条目按词长降序合并 alternation；单字词强制 CJK+字母数字双侧边界 `(?<![\p{L}\p{N}])...(?![\p{L}\p{N}])`，多字词 whole_word 时加；regex 条目逐条 try/catch 编译，失败 warn 跳过。
- **缓存失效按内容版本**：store 每次变更 bump `contentVersion`（自增计数），编译缓存持有 version 比对（教训 6：不得比长度）；测试直接改表也经 store，杜绝绕过。
- 管线插入位置：窗口扫描之后；命中 `Finding{category: safeLabel(label)}`；safeLabel：`toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12) || 'TERM'`；`mask-registry.ts` 短码白名单放开为 `^[A-Z0-9_]{1,12}$`（防套娃/分段保护回归必须绿）。
- .env 导入（R1.5）为纯前端解析 + 批量 POST：逐行 `^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$`，取 VALUE 剥引号，空值/`#` 注释跳过；预览列表勾选后批量提交，label 默认 ENV。

## 4. 响应侧分析（R3）

新 `src/proxy/response-analysis.ts`：

- `analyzeResponse({ status, text, forwardMap, requestModel, responseModel, streamStats }): Signal[]`——内部全 try/catch，永不 throw。
- SCAN_WARN：跑 secrets + pii(enabled) + customWords，命中值不在 forwardMap → SCAN_WARN；detail 仅类别 + 打码 preview（前 80 字符，敏感值不落库）。
- error_leak：status≥400 → secret 正则 + 高熵 token（len≥20 且 entropy>3.0）→ HIGH/CRITICAL。
- identity_swap：响应 `model` 字段 vs 请求 model 首段家族比对（请求无 model 跳过）→ MEDIUM。
- response_poison：零宽字符计数≥8、双向覆盖符（U+202A-202E/U+2066-2069）→ HIGH/MEDIUM；凭据回流（命中 forwardMap 且非还原回声）→ MEDIUM。
- sse_anomaly：流式侧统计（JSON 解析失败帧占比、未知 event 类型）→ LOW。
- dangerous_action：自拟 ~21 条危险命令结构正则（rm -rf /、dd of=、DROP DATABASE、curl|sh 等）→ LOW。
- severity_floor 过滤后 `signals-store.insert`（关联 audit_id）。
- 接入：非流式在 finalizeUpstream restore 后（对 restore 后文本分析）；流式经 restore 的逐帧通道复用累积文本（restore.ts 输出侧统计，见 §5 接口）。bypass/legacy 链路不接。

## 5. 流式还原协议硬化（R7，`src/proxy/restore.ts` + `streaming.ts`）

现状缺陷（调研核实）：通道键 = JSON 路径 + 数组位置索引；chat 稀疏分片（index≠position）跨 choice 污染；Anthropic/Responses 扁平事件信封（根级 `delta`）全块共享通道；仅流尾全局 flush；无 `.done` 快照清理。

### 5.1 通道键解析（新 `src/proxy/restore-channels.ts`）

`resolveChannelKey(parsed, fallbackPath): string | null`——按事件信封判定：

- OpenAI chat/completions：`choices[i]` 存在 → 键 `c{choice.index ?? i}.{字段路径}`（index 为非负 int 才采信，教训 1）；无 choices → fallbackPath。
- Anthropic：`type` 为 `content_block_delta/content_block_start/content_block_stop` → 键 `b{index}.{text|json}`（按 `delta.type` 分 text_delta/input_json_delta）。
- Responses：`type` 以 `response.` 开头 → 键 `r{output_index}.{content_index>0 ? content_index+'.' : ''}.{kind}`，kind 由事件名推导（output_text→text、reasoning_text→reason、function_call_arguments→args）（教训 2：不用 item_id）。
- 判定不出 → fallbackPath（保持现 JSON 路径行为，未知协议零回归）。

restoreDeep 遍历时把「叶子所属的事件级通道键」传下去：`restoreChannel(semanticKey ?? path, text)`；lastFrame/lastPath 仍按真实 JSON 路径记录（flush 克隆模板用）。

### 5.2 终态通道级 flush（教训 4）

`terminalChannels(parsed): string[] | 'all' | null`：

- `message_stop`/`message_delta`/`response.completed`/`response.incomplete`/`response.failed` → 'all'。
- `content_block_stop` → `['b{index}.']` 前缀匹配。
- `choices[].finish_reason` → `['c{choice.index ?? i}.']`。
- `response.output_text.done` / `reasoning_text.done` / `function_call_arguments.done` → 快照语义（见 5.3）。

终态触发时对匹配通道执行现 flush 逻辑（restore leftover → 克隆 lastFrame 模板补发 delta），**非匹配通道 pending 原样保留**。

### 5.3 `.done` 快照清理（教训 3）

三 类 `.done` 事件：整树正常还原（快照文本可能含占位符，走通道还原）→ 随后 `pending.delete(key)` + 删除 flush 模板记录 → 不再为该通道补发。注意：快照字段路径与 delta 字段路径不同（`text` vs `delta`），快照本身经 fallbackPath 或按 kind 映射到同一语义键处理。

### 5.4 健壮性（R7.4）

- flush 循环内单通道 try/catch：单通道异常不影响其他通道补发。
- 正则回溯审计：STRICT_TAG_STICKY（anchored）有界；drain() 索引扫描线性；LOOSE_RX 形态 `\{{0,2}([A-Z0-9_]{1,12}_[bcdfghjkmnpqrstvwxz]{5})\}{0,2}` 有界——补 restore 基准用例进 `npm run bench`。
- 流尾 flush() 行为不变（剩余 pending 全部补发）。

### 5.5 测试矩阵（AC7）

chat 多 choice 稀疏 index 交错分片；chat 单 choice index=2 位置=0；Anthropic 双块交错 + content_block_stop 局部 flush；Responses 多 part（content_index=0/1）+ `.done` 后无补发；finish_reason 中途 flush 该 choice；解析失败帧透传；legacy/未知形状回退路径键；全量既有还原回归。

## 6. Dashboard（R1/R8）

- 新页 `/dashboard/words`：分类分组表格 + 新增/编辑 dialog + 启停 switch + 整词 switch + 删除确认 + 正则前端预校验 + `.env` 粘贴导入 dialog（解析预览→勾选→批量提交）。
- Settings 页新增：规则开关清单（分组渲染）、secret_prefixes + 最小长度、log_retention_days（非负整数防呆）、audit_severity_floor、fail_closed、max_body_mb。逐项独立保存。
- Audit 页行展开 signals 区块；Overview 信号计数卡（近 24h 按 severity）。
- API：`/api/admin/words`（CRUD + bulk）、`/api/admin/signals`（查询，可并入 audit 查询）。
- i18n 补 key；侧栏加 Words 项（无 Clients/Stats 页）。

## 7. 留存/加固/鉴权（R4/R5/R6）

- `src/audit/retention.ts`：`pruneExpired()`（audit_log + audit_signals，ts < cutoff，返回计数）；启动 + setInterval 1h（unref）。
- R5：route.ts 读 body 前后双重 size 检查 → 413；`runPipeline`/`maskJsonBody` 调用点 try/catch → fail_closed 503 `{error:"mask_failed"}` / fail-open 放行记 ERR。**先核实 pipeline.ts:17-76 既有 catch**（现为隐式 fail-open 则将其纳入开关控制，语义显式化）。未知形状测试锁定：构造新协议形状 JSON（键不在已知白名单）断言 findings 非空。
- R6：新增 `src/middleware.ts` 匹配 `/api/admin/:path*`：Origin/Referer 非同源且不在 ALLOWED_ORIGINS → 403；无 Origin 头放行；TRUST_PROXY=1 信任 X-Forwarded-Proto；DISABLE_ORIGIN_CHECK=1 跳过。

## 8. 权衡记录

- **语义通道键 + 未知形状回退**：三种协议特判 + fallbackPath，协议覆盖明确、未知协议零回归；代价是 restore-channels.ts 需随新协议演进（可接受，测试矩阵锁定）。
- **SCAN_WARN 不落完整命中值**：响应侧发现的新敏感值落库即新泄漏面；只存类别+打码 preview。
- **快照还原后 pop 而非 flush**：`.done` 快照已含全文，补发 delta 反而重复；maskit 同款语义（0bc1ea7）。
- **mask_* 列顺手补齐**：logger 已构造未落库的雏形缺陷，属审计正确性，纳入本期。
- **不做字节级 splice**（maskit b304bfa）：保客户端排版前缀命中上游 prompt cache，收益真实但工程重且非隐私本职 → backlog。
- **不引图表库/无 Stats 页**：用量统计剔除后仅剩信号计数卡，纯数字卡片即可。

## 9. 回滚

- 全部新表独立、audit_log 新列可空——回退代码即可，无破坏性 migration。
- 词库表为空时管线行为与现状一致；R7 通道键对未知形状回退 JSON 路径（现状行为）；fail_closed 可运行时关闭。
- Origin 校验带环境变量逃生舱。
