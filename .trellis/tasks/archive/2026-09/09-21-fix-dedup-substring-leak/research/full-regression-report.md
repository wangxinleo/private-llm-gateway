# F1 修复：完整桌面回归结果与边界说明（归档补充，2026-09-21）

> 本文是 `implement.md` 步骤 7 的**完整版**回归记录（先前提交 `e81e896` 的描述仅含定点复验；本报告为修复后构建上的全批次桌面回归 + 边界声明）。
> 运行对象：提交 `e81e896`（修复）构建产物，未再改代码；本文件仅归档文档。

## 环境

- 网关：生产构建 `node .next/standalone/server.js`，端口 3210（**全新 DB** `regress.sqlite`，带非法 env：`PRIVACY_MASK_FORMAT=Legacy`、`PRIVACY_SUFFIX_SECRET=short`）；另一实例 3211（合法 env 对照）。
- 上游：真实 mock（:8787 场景路由：echo 回显 base64 / gzip-json / zstd-json / gzip-sse / zstd-sse / unknown-encoding）。
- GUI：无头 Edge + 原生 CDP（登录 → 总览 → 敏感词库 → 审计日志）。
- 证据文件（临时目录，已随环境清理）：`/tmp/llm-verify/gw-regress.log`、`shot-1..4-*.png`；关键原始输出已内联于 §2。

## 1. 结果总表

| # | 场景 | 结果 | 说明 |
|---|---|---|---|
| 1 | T7 非法 env（:3210 首请求） | ✅ | stderr 2 条 WARN（MASK_FORMAT=Legacy / SUFFIX_SECRET 长度 5） |
| 2 | T7 合法 env 对照（:3211） | ✅ | 告警 0 条 |
| 3 | T1 thinking 跳过 | ✅ | thinking 内 `AcmeCorp`/`13900139000` 原样；用户与 assistant 普通文本号码照常脱敏 |
| 4 | T5 默认关（新库初始 false） | ✅ | `fe80::1`/`2001:db8::1`/MAC 全原样 |
| 5 | T5 开启 + 全探针 | ✅ | 4 处私网全脱敏（**含 F1 首处独立出现**）；`2001:db8::1`/`::1`/MAC/`8080`/`12:30` 全放行 |
| 6 | T2 gzip-json | ✅ | 无 `content-encoding`、body 还原明文 |
| 7 | T2 zstd-json | ✅ | 同 6（网关自解压） |
| 8 | T2 gzip-sse | ✅ | 流式帧完整、占位符还原 |
| 9 | T2 zstd-sse | ✅ | 同 8 |
| 10 | T2 unknown-encoding | ✅ | 原头保留、字节未动 |
| 11 | T2 转发侧 accept-encoding | ✅ | 上游收到 `gzip, deflate, br`（zstd 剔除） |
| 12 | F1 例 1（IPv6 双出现） | ✅ | 两处均占位符 |
| 13 | F1 例 2（卡号内含手机号 + 独立手机号） | ✅ | 两处均占位符；审计 `findings:["PHONE","BANK_CARD"]`、maskCount=2 |
| 14 | F1 嵌套保持性（仅长值出现） | ✅ | 单个 `{{BANK_CARD_...}}`、无残余数字、无 PHONE 标签 |
| 15 | 无命中放行路径 | ✅ | 透传、响应无编码头 |
| 16 | 并发冒烟（16 并行） | ✅ | 全 200；mask 路径 4/4 生效；响应无 `content-encoding` |
| 17 | GUI（登录/词库/审计） | ✅ | 登录成功；敏感词库 38 规则码含 `IPV6_PRIVATE`（索引 29）；审计页正常渲染 28 条 |
| 18 | CI 门禁（配套） | ✅ | 517 tests / 9 skipped、`npm run build` 绿 |

## 2. 关键原始证据（内联存档）

**T7（:3210 日志）**
```
WARN  [env] PRIVACY_MASK_FORMAT="Legacy" 非法（期望: legacy | semantic）,已按 semantic 处理
WARN  [env] PRIVACY_SUFFIX_SECRET 长度 5 < 16,已忽略并回退进程随机密钥（重启/多副本下占位符后缀不一致,…）
```

**T1（上游实收，base64 解码后节选）**
```json
"content":[{"type":"thinking","thinking":"用户提到 AcmeCorp，手机 13900139000，需要记住","signature":"sig-abc-123"}]
…
"text":"请记录我的手机 {{PHONE_tkjmm}}"      ← 用户消息脱敏
"text":"你的手机 {{PHONE_srkps}} 已记录"      ← assistant 普通文本脱敏
```

**T5 开启后（上游实收，节选）**
```
内网 {{IPV6PRIV_khpxs}} 大小写 {{IPV6PRIV_vxtvd}} 带zone {{IPV6PRIV_rrdhq}} 键值 IPV6:{{IPV6PRIV_qbvmk}} 文档 2001:db8::1 环回 ::1 MAC aa:bb:cc:dd:ee:ff 端口 8080 时间 12:30
```
（首处独立出现的 `fe80::1` 已脱敏——F1 修复生效；负例全放行）

**T2（响应头 + body，节选）**
```
/scenario/gzip-json → x-received-accept-encoding: gzip, deflate, br | body: {"choices":[{"message":{"content":"已记录 13800138000"}}]}
/scenario/zstd-json → 同上（无 content-encoding）
/scenario/gzip-sse  → data: {"choices":[{"delta":{"content":"流式 13800138000"}}]} … data: [DONE]
/scenario/zstd-sse  → 同上
/scenario/unknown-encoding → content-encoding: compress | body: opaque-body
```

**F1 例 2（上游实收 + 审计 API）**
```
卡号 {{BANK_CARD_nkrxv}} 与手机 {{PHONE_tkjmm}}
GET /api/admin/audit → {"findings":["PHONE","BANK_CARD"],"maskCategories":["PHONE","BANK_CARD"],"maskCount":2}
```

**并发冒烟（16 请求全并行）**
```
echo-mask: n=4 http200=4 masked=4 enc-null=4
zstd-sse:  n=4 http200=4 enc-null=4
gzip-json: n=4 http200=4 enc-null=4
echo-allow:n=4 http200=4 enc-null=4
ALL 200 OK
```

## 3. 边界说明（本次回归未覆盖的路径，均与 F1 改动无交集或另有覆盖）

| 未覆盖路径 | 理由 |
|---|---|
| multipart/form-data 桌面链路 | 走同一 `runPipeline`；F1 变更点在 findings 合并层，已有单测覆盖；上一批次桌面验证曾覆盖 multipart 重建 |
| 自定义词的 **UI 写操作**（本次经 API 种词） | UI 写操作在上一批次（09-15/16 Clients 会话）已桌面验证；本次只关心扫描行为 |
| reveal 揭示原始值流程 | 与 findings 去重无交互（读取路径未改） |
| 真实第三方上游（OpenAI/Anthropic 等） | 仍为 mock；协议形状覆盖由 517 测试与 mock 场景承担 |
| 长文本性能 | 由 CI 内基准测试（`apply-masks-scaling` 等）守护，全量测试通过 |

## 4. 观察（非缺陷）

- 修复后嵌套场景同时保留两个类别 finding → disambiguation notice 的示例标签随 `maskSummary.categories[0]` 变化（例：`<<PRIVACY_MASK:PHONE>>` 取代 `BANK_CARD`）；仅影响提示文案示例，占位符格式/还原不受影响。
- 审计计数在嵌套场景增加（如卡号内含手机号：1 → 2）属预期，已在 spec Gotcha 中声明。

## 5. 复现方法

```bash
# 1) 启动 mock 与网关（生产构建，全新 DB，可带非法 env 观察 T7）
node /tmp/llm-verify/mock.mjs &                       # :8787 场景路由
cd .next/standalone && PORT=3210 DB_PATH=/tmp/regress.sqlite \
  UPSTREAM_URL=http://127.0.0.1:8787 ADMIN_KEY=<key> node server.js
# 2) 经 /api/admin/config 开 IPV6_PRIVATE；/api/admin/words 种自定义词
# 3) 逐场景 POST /scenario/{echo,gzip-json,zstd-json,gzip-sse,zstd-sse,unknown-encoding}
# 4) audit 查询断言 findings/maskCount；GUI 用无头 Edge CDP 复核
```
