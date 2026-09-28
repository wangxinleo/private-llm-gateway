# 设计:彻底移除旧格式脱敏机制(explicit/legacy)

## 1. 目标态与不变式

- 唯一掩码格式:`{{LABEL_suffix}}`(MaskRegistry 懒铸);唯一还原协议:restore.ts(严格 TAG_RE + 宽松 LOOSE_RX)。
- **I1 registry 恒存在**:请求处理链路无条件 `new MaskRegistry()`(route.ts:353 去三元);类型层以必填参数编码,不靠文档约定。
- **I2 Finding 零标签**:删除 `Finding.maskTag`;标签只在 apply 时经 `registry.tagFor` 产生并记入 `pairs`(字节级 splice 复用)。
- **I3 未知文本透传**:restore 只替换 registry 命中标签,不存在格式白名单(现状语义,不改)。

## 2. 接口变更

| 接口 | 现状 | 目标 |
|---|---|---|
| `applyMasks(text, findings, registry?, pairsOut?)`(pii.ts:269) | registry 可选 | registry **必填** |
| `runPipeline(text, bodySize, filenames?, registry?)`(pipeline.ts:19) | 第4参可选 | registry **必填** |
| `maskJsonBody(body, scan, registry?)`(json-mask.ts:263) | 第3参可选 | registry **必填** |
| `ScanFn`(json-mask.ts:6) | `(text, size, registry?) => ScanResult` | 保持 `(text: string, size: number) => ScanResult`——registry 由调用方闭包携带(route.ts:459 既有形态),maskJsonBody 用自己的 registry 做 applyMasks,不向 scan 透传 |
| `Finding.maskTag?`(types.ts:85) | 可选字段 | 删除 |
| `MaskResult.registry?`(pii.ts:261) | 可选 | 不动(最小改动) |

**bypass 路径**(route.ts:381-390):现为 registry-less 扫描且 maskedBody 被丢弃(转发原文 bodyText:432)。改为 `const scratch = new MaskRegistry()` 传入(仅满足签名/一致性,零输出影响)。

## 3. 生产删除清单

- `config.ts`:91 常量、112 导出项、101-102 默认通知文本去掉旧格式样例(保留 `{{EMAIL_trwmq}}`)。
- `route.ts`:22 导入、352 注释、353 三元、531 注释、534 `registry ? ... : undefined`(registry 恒在,直接传)。
- `env-check.ts`:14-20 `PRIVACY_MASK_FORMAT` 规则块。
- `mask-tag.ts`:4 幽灵默认、6-11 `buildMaskTag`、116 `EXPLICIT_TAG_RE`、117 `LEGACY_TAG_RE`。
- `types.ts`:85 `maskTag?`。
- `secrets.ts`:52 `PRIVACY_MASK_TOKEN_RE`、97 规则、104/123 maskTag 字段与赋值、180 prune 透传、202 `buildMaskTag("CONTEXTUAL_SECRET")`;2 行导入调整。
- `pii.ts`:2 导入、240 字段、275 filter 条件(去 `f.maskTag &&`)、341/376 兜底读改 `registry.tagFor(...)` 直读。
- `context-key.ts`:3 导入、411 字段;`custom-words.ts`:2 导入、102 字段;`entropy.ts`:3 导入、117 字段。
- `scanner/index.ts`:`buildMaskTag` 导出行。
- `disambiguation.ts`:2 导入 `EXPLICIT_TAG_RE`、14 `NOTICE_SAMPLE_RE` 退化为仅 `TAG_RE`。

## 4. 测试改造

断言策略(保强度):
- 精确断言 → 确定性 registry `new MaskRegistry(() => "bcdfg")`,期望 `{{LABEL_bcdfg}}`;
- 非精确断言 → 正则 `/\{\{SECRET_[bcdfghjkmnpqrstvwxz]{5}\}\}/`(route-proxy.test.ts:97 既有形态);
- 无标签断言降级为 `category`/`action`/`matched`。

| 文件 | 改动 |
|---|---|
| `mask.test.ts`(22 夹具/40 字面量) | helper 增 registry 参;夹具去 maskTag;期望改 `{{LABEL_bcdfg}}` |
| `json-mask.test.ts`(26 字面量) | `scan` 闭包携带 registry;`maskJsonBody(..., registry)`;期望改语义/正则 |
| `pipeline.test.ts`(7) | `runPipeline(..., registry)` + 语义断言 |
| `image-base64.test.ts`(4) | 同上(注意其中 provider/jwt/base64 期望改正则) |
| `secrets.test.ts`(14 maskTag) | 断言降级为 category/matched;去夹具字段 |
| `pii.test.ts`(6+8) | maskTag 断言改 category;`applyMasks` 用例传 registry |
| `policy.test.ts`(7) / `audit-logger.test.ts`(1) / `context-key.test.ts`(1) | 夹具去 maskTag;maskTag 断言改 category |
| `mask-tag.test.ts`(20) | buildMaskTag explicit 套件整删(文件若仅此内容则删文件;若含 suffix/短码用例则保留其余) |
| `restore.test.ts`:40-44 | 删 legacy/explicit 用例(46-49「未签发形态透传」已覆盖同语义) |
| `disambiguation.test.ts`(36) | 夹具去 maskTag;删旧格式字面断言(保护目标由 E2E AC2 承接);⑤ env 覆盖用例删除(前提=已移除的通知清洗) |
| `route-proxy.test.ts`:107-136 | 前置探针改 `phone: 13912345678`(PHONE 全文扫描);断言改语义正则 |
| `env-check.test.ts` | 删 `PRIVACY_MASK_FORMAT` 全部用例 |
| `benchmarks/apply-masks-scaling.test.ts` | `buildMaskTag` 导入去;registry 构造;`runPipeline` 补 registry |
| `custom-words.test.ts` / `pii-extended.test.ts` / `dedup-substring-leak.test.ts` | 无 registry 的调用点补 registry;dedup 夹具去 maskTag |

未改:`splice/upstream-state-skip/high-entropy/ipv6-private/restore-stress` 已是 registry 形态。

## 5. 文档

- `README.md`:160 删行;209-213 示例改 `{{EMAIL_trwmq}}` / `{{BEARER_bcdfg}}` / `{{SECRET_bcdfg}}`。
- `README.zh-CN.md`:144 删行;194-196 同步。
- `.trellis/spec/backend/reverse-proxy.md`:318/328/384 改语义示例;全 spec grep 兜底其余出现。

## 6. 破坏性与兼容(明示项)

- 部署曾设 `PRIVACY_MASK_FORMAT=legacy`:knob 移除后忽略,输出由 `[CAT]` 变 `{{...}}`;只认旧格式的客户端还原器会看到占位符原文。README 不再提 knob(零命中约束),破坏性在交付报告 + 任务归档明示。
- 入站旧 token 不再重打码:原样上行;模型回显时原样返回客户端(用户裁决「字面零存在」的已知代价)。

## 7. 验证

- 静态:`rg -n 'PRIVACY_MASK' src README.md README.zh-CN.md` 零命中;`rg -n 'PRIVACY_MASK_FORMAT' --glob '!node_modules' --glob '!.trellis' --glob '!.git' .` 零命中。
- 官方门:`npm ci` + `npm test` + `npm run build`(ci.md)。
- E2E:mock 上游 + dev 实例(09-23 批次方法):mask 探针(如 `13912345678`)→ 上游可见载荷为 `{{PHONE_xxxxx}}`、通知样例=真实签发标签、无旧格式;客户端输出逐字还原;`X-Privacy-Masked` 头不变。

## 8. 回滚

纯代码改动、无 DB 迁移;单提交 revert 即可。改动不触碰扫描规则集(除删除一条合成规则)与还原协议。

## 9. 风险与对策

- 测试改写面大(13 文件/~50 调用点)→ 确定性 registry 保精确断言,防改写导致断言弱化。
- 无 tsc 门(ci.md):签名必填化遗漏靠 vitest 运行期暴露(registry 为 undefined 时 `tagFor` TypeError),不会静默。
- restore 透传语义不动 → 不会因移除而改变响应侧行为。
