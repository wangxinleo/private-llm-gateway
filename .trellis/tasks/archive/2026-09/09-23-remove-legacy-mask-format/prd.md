# 彻底移除旧格式脱敏机制(explicit/legacy)

## Goal

用户决策(2026-09-23,审计后两项裁决:「彻底移除旧机制」+「字面零存在」):旧格式 `<<PRIVACY_MASK:CAT>>` / `[CATEGORY]` 违反「可复原」设计基座,需移除其全部生产机制、防御识别规则与残留,使生产链路只存在语义格式 `{{LABEL_suffix}}` 与单一还原协议。

用户价值:单一掩码格式 ⇔ 单一还原协议;消除「模式/分支组合」心智负担,以及不可还原格式再次泄漏的结构性可能。

## Background(审计证据,2026-09-23)

只读全库审计结论(非测试代码中 `<<PRIVACY_MASK` 字面仅 6 处,逐条判定):

- 默认 semantic 部署**已无旧格式活生产点**;最后一个(通知样例)已由 `09-23-custom-term-legacy-tag-leak` 修复(disambiguation.ts:64)。
- `buildMaskTag` 显式分支在生产中**不可达**:非 legacy 时 route.ts:353 恒建 registry,`finding.maskTag` 只被 legacy 兜底读(pii.ts:341/376);legacy 时 buildMaskTag 走 `[CATEGORY]` 分支(mask-tag.ts:7-9)。
- 惰性残骸:`mask-tag.ts:4` 幽灵默认 `"explicit"`(env-check.ts:17 只承认 legacy|semantic;config.ts:91 默认 semantic);`LEGACY_TAG_RE`(mask-tag.ts:117)**零引用**;`scanner/index.ts` 桶导出 `buildMaskTag` **无导入者**;审计库只存 category 与 matched(audit/logger.ts:18-33),maskTag 不落库、不进响应头。
- 防御识别(本次一并移除):secrets.ts:52/97 入站旧 token 重打码;disambiguation.ts:14 通知清洗 regex(含 EXPLICIT_TAG_RE,上一批次新增)。
- restore.ts:16-35 对未签发形态透传(restore.test.ts:40-44)——**行为保留**(只替换 registry 命中标签,是唯一自然语义),仅清理其测试用例中的旧格式字面。
- 文档/测试残留:README.md:160/209-213、README.zh-CN.md:144/194-196、`.trellis/spec/backend/reverse-proxy.md:318/328/384`;13 个测试文件约 166 处旧格式字面量、9 个文件含 maskTag 夹具。
- knob 影响面:仅 `src/`(6 文件)+ README 两处;`.env.template`/docker-compose.yaml/Dockerfile 无引用。

## Requirements

- **R1 移除格式 knob 与 legacy 运行路径**:config.ts:91 与 :112 导出;route.ts:22 import 与 :353(registry 恒建);env-check.ts:14-20 规则;README 环境表两行。
- **R2 移除生产机制**:mask-tag.ts `buildMaskTag`(6-11)与幽灵默认(4);types.ts:85 `Finding.maskTag`;5 个生产点(pii.ts:240、secrets.ts:123/202、context-key.ts:411、custom-words.ts:102、entropy.ts:117);2 个兜底读(pii.ts:341/376 改 registry 直读);secrets.ts:104/180 的 maskTag 字段与 prune 同步清理;`applyMasks`/`runPipeline`/`maskJsonBody` 的 registry 参数改**必填**(类型层编码「registry 恒存在」不变式);`scanner/index.ts` 桶导出删除;`LEGACY_TAG_RE` 删除。
- **R3 移除防御识别(字面零存在裁决)**:删除 `EXPLICIT_TAG_RE`(mask-tag.ts:116);secrets.ts:52 `PRIVACY_MASK_TOKEN_RE` 与 :97 规则;disambiguation.ts:14 `NOTICE_SAMPLE_RE` 退化为仅 `TAG_RE`。src 中旧格式字面零命中。
- **R4 通知默认文本去旧格式**:config.ts:102 移除 `<<PRIVACY_MASK:EMAIL>>` 示例(保留 `{{EMAIL_trwmq}}`,注入时仍替换为真实签发标签)。
- **R5 测试改造**:13 个文件夹具/断言改语义格式;mask-tag.test.ts explicit 套件删除;restore.test.ts:40-44 删除(46-49「未签发形态透传」已覆盖同语义);env-check.test.ts 移除 knob 用例;route-proxy.test.ts:107-136 前置探针改 PHONE。
- **R6 文档更新**:README.md/README.zh-CN.md 删环境表行、示例 token 改 `{{...}}`;`.trellis/spec/backend/reverse-proxy.md:318/328/384` 契约与示例改语义格式。

## Acceptance Criteria

- [ ] AC1 字面零存在:`rg -n 'PRIVACY_MASK' src README.md README.zh-CN.md` 零命中;`rg -n 'PRIVACY_MASK_FORMAT' --glob '!node_modules' --glob '!.trellis' --glob '!.git' .` 零命中。
- [ ] AC2 默认部署 E2E:mask 请求经本地实例往返,上游可见载荷与客户端输出均为 `{{...}}`,通知样例为真实签发标签。
- [ ] AC3 仓库官方门全绿(`npm ci` + `npm test` + `npm run build`,ci.md)。
- [ ] AC4 行为不变式:mask/allow/block 决策、还原协议(含未签发形态透传)、通知注入落点与守卫(off/非 mask/空 registry/multipart)与现状完全一致。
- [ ] AC5 破坏性明示:若部署曾设 `PRIVACY_MASK_FORMAT=legacy` → 输出由 `[CAT]` 变 `{{...}}`;入站旧 token 不再重打码(原样上行/回显)。在交付报告 + 任务归档明示(README 不提 knob,受 AC1 约束)。

## Out of Scope

- 不改扫描面(EMAIL 仅窗口命中、短码机制)——现象①已按用户复核闭环为非缺陷。
- 不新增输出侧旧格式残留告警(placeholder-scan 检测缺口已记录,是否立项另议)。
- 不处理 tsc 12 个 HEAD 基线错误。
- 不改 `X-Privacy-Masked`/`X-Privacy-Mask-Types` 调试头与 `maskSummary` 结构。

## Technical Notes

- 断言策略:精确断言用确定性 registry(`new MaskRegistry(() => "bcdfg")`);非精确用 `/\{\{[A-Z][A-Z0-9_]*_[bcdfghjkmnpqrstvwxz]{5}\}\}/` 正则;无标签断言降级为 category/action/matched。
- bypass 路径(route.ts:384-387)传临时 registry,零输出影响(maskedBody 本被丢弃)。
- 具体文件级改动清单见 design.md §3/§4/§5;执行顺序见 implement.md。
