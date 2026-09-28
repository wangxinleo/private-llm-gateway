# 实施计划:彻底移除旧格式脱敏机制

前置:`python3 ./.trellis/scripts/task.py start 09-23-remove-legacy-mask-format` 后开工;改动前先读 design.md 与本任务注入的 spec。

## 步骤

1. **基础层收敛**
   - `src/scanner/mask-tag.ts`:删 4/6-11/116/117;保留 TAG_RE/LOOSE_RX/短码/HMAC 后缀全套。
   - `src/types.ts`:删 `maskTag?`(85)。
   - `src/scanner/index.ts`:删 `buildMaskTag` 导出。
2. **生产调用链(签名必填化 + 字段清理)**
   - `src/scanner/pii.ts`:2 导入、240、275、341/376、269 签名。
   - `src/scanner/secrets.ts`:2 导入、52、97、104、123、180、202。
   - `src/scanner/context-key.ts` 411、`custom-words.ts` 102、`entropy.ts` 117。
   - `src/scanner/pipeline.ts`:19 签名必填。
   - `src/scanner/json-mask.ts`:263 签名必填;`ScanFn` 保持两参。
3. **路由与配置**
   - `src/app/[...path]/route.ts`:22、352-353、384-387(bypass 传临时 registry)、459、471-474、520、531-534。
   - `src/config.ts`:91 常量、112 导出项、101-102 通知文本样例(去掉旧格式,保留 `{{EMAIL_trwmq}}`)。
   - `src/lib/env-check.ts`:14-20 规则块。
   - `src/proxy/disambiguation.ts`:2 导入、14 NOTICE_SAMPLE_RE 退化仅 TAG_RE。
4. **测试改造**(按 design.md §4 表逐文件;先生产后测试,分批跑)
   - 批A(mask 核心):mask.test.ts、pii.test.ts、secrets.test.ts、context-key.test.ts。
   - 批B(json/管线):json-mask.test.ts、pipeline.test.ts、image-base64.test.ts、custom-words.test.ts、pii-extended.test.ts、dedup-substring-leak.test.ts。
   - 批C(决策/审计/环境):policy.test.ts、audit-logger.test.ts、env-check.test.ts。
   - 批D(还原/通知/路由):restore.test.ts、disambiguation.test.ts、route-proxy.test.ts。
   - 批E(基准/废弃):benchmarks/apply-masks-scaling.test.ts、mask-tag.test.ts。
5. **文档**:README.md、README.zh-CN.md、.trellis/spec/backend/reverse-proxy.md(318/328/384 + 全 grep 兜底)。
6. **验证与 E2E**:design.md §7 三件套;E2E 复用 09-23 批次方法(mock 上游 + dev 实例),证据写入 `research/probe-evidence.md`。

## 验证命令

- `rg -n 'PRIVACY_MASK' src README.md README.zh-CN.md` → 零命中
- `rg -n 'PRIVACY_MASK_FORMAT' --glob '!node_modules' --glob '!.trellis' --glob '!.git' .` → 零命中
- `npm ci && npm test && npm run build`
- E2E 步骤与断言:design.md §7

## 风险文件 / 回滚点

- `src/app/[...path]/route.ts`(bypass 与 finalize 路径):改后逐路径复查 registry 传递。
- `src/scanner/pii.ts`(applyMasks 主替换内核):仅签名与兜底读改动,替换逻辑零触碰。
- 回滚:单提交 revert;无 DB/协议兼容层。

## 完成前检查

- [x] 三件套验证通过(门 + E2E + rg 零命中)——见 research/probe-evidence.md
- [x] 行为不变式 AC4:mask/allow/block 决策、注入落点与守卫、还原协议无变化(570 测试全绿 + E2E 三探针)
- [x] 破坏性(legacy 部署/入站 token)写入交付报告(任务 §6 + probe-evidence 探针 2)
- [x] 上一批次(09-23-custom-term-legacy-tag-leak)新增测试的旧格式字面断言已按其 design 承接关系清理
