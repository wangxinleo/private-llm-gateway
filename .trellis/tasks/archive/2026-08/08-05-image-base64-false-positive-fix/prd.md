# 修复图片 base64 被扫描器误判打码导致上游 token 计数失败

## Goal

消除隐私扫描器对 LLM 请求中图片/文件二进制 payload 的误判打码:当 JSON 请求体里的 base64 图片数据包含 `eyJ` + 40+ 字符序列时,`BASE64_TOKEN` 规则会命中并把该子串替换成 `<<PRIVACY_MASK:BASE64_TOKEN>>`,破坏 base64 合法性;上游 new-api 解码时报 `failed to decode base64 data: illegal base64 data at input byte N`(`count_token_failed`),请求直接失败。修复后图片请求的 base64 数据必须原样透传,同时不降低对真实文本密钥的扫描覆盖。

## Background

- 网关对 `application/json` 请求体走 `maskJsonBody`(`src/scanner/json-mask.ts`),递归扫描每个字符串值,命中 `mask` 类 finding 后替换为 mask tag 并转发。
- `src/scanner/secrets.ts` 的 `BASE64_TOKEN_RE = /eyJ[A-Za-z0-9_-]{40,}/g` 会命中任意字符串中 `eyJ` 开头的 43+ 字符序列。base64 图片数据(随机字节)以约 `2.4%`(22.5KB base64)到 `17.6%`(240KB base64)的概率天然包含此类序列(实测 500 张随机 PNG)。
- 命中后 mask tag 含 `<`、`>`、`:` 等非 base64 字符,上游 `base64.StdEncoding.DecodeString` 在第一个非法字节处报错——字节位置与 mask tag 位置一致(用户报错字节 22491 与此吻合)。
- 受影响的真实请求形态(均已实测/代码确认):
  - OpenAI-compatible `image_url.url` = `data:image/png;base64,<data>`(Chat / Responses / Codex)。
  - Anthropic `/v1/messages` `source.data` = 裸 base64(`type: "base64"`)。
  - Gemini `inline_data.data` = 裸 base64(带 `mime_type`)。
- PII 和 context-key 扫描器对随机 base64 基本免疫(连续数字串概率趋近于 0),唯一高频误判源是 `BASE64_TOKEN`。
- multipart 路径不采集文件 blob 作为文本(`collectMultipartText` 只取字符串字段),不受本 bug 影响;但 multipart 转发体拼接问题(route.ts 用拼接文本替代原始 multipart body)是独立缺陷,不在本次范围。
- 上游行为已确认:`QuantumNous/new-api` `service/file_service.go` 对 data URI 按第一个逗号切分后做严格 base64 解码;`GetIdentifier()` 将报错 identifier 截断为 50 字符("..." 是截断显示,非数据截断)。

## Requirements

### R1. 数据 URI 值不再被扫描

`maskJsonBody` 扫描过程中,值匹配 `^data:[a-zA-Z0-9+.-]+/[a-zA-Z0-9+.-]+;base64,` 的字符串(含其后的 base64 数据)必须原样返回:不产生 finding、不打码、不参与 block 判定。覆盖 `image_url.url`、文件/音频/视频 data URI。

### R2. 裸 base64 二进制字段不再被扫描

Anthropic/Gemini 形态的裸 base64 字段(值为纯 base64、长度 ≥ 64、所在键名为 `data`)必须原样返回:不产生 finding、不打码。判定必须足够精确,避免误伤真实文本。

### R3. 文本密钥扫描覆盖不降级

以下场景必须保持原有行为(回归保障):
- 提示词文本中的 `sk-...`、Bearer token、JWT 等真实密钥仍被识别并打码。
- 非 `data` 键名下、作为普通文本出现的长 base64 字符串(如用户粘贴待分析的 token)仍被 `BASE64_TOKEN` 规则扫描并打码。
- `block` 类规则(如 PRIVATE_KEY)在文本中的行为不变。

### R4. 修复必须可验证

- 提供针对性的回归测试:构造含 `eyJ` + 40+ 字符的图片 data URI / 裸 base64 字段,断言 `maskJsonBody` 输出与输入完全一致(`action: "allow"`、无 finding、base64 逐字节不变)。
- 提供批量概率验证:对随机图片 base64 样本(与报错同量级 ~22.5KB,以及更大样本)断言扫描零命中、报文零变更。
- 全量测试套件通过(`npm test`),`tsc` 无类型错误。

## Acceptance Criteria

- [ ] `image_url.url` 为 data URI 且内含 `eyJ`+40+ 序列时,`maskJsonBody` 返回 `action: "allow"`,输出 body 与输入逐字节一致。
- [ ] Anthropic `source.data` / Gemini `inline_data.data` 为裸 base64 且内含 `eyJ`+40+ 序列时,输出与输入一致,无 finding。
- [ ] 文本中的 `sk-`、JWT、`Bearer` 等真实密钥仍被正确打码(既有/新增回归测试通过)。
- [ ] 500 张随机图片 base64(≥22.5KB)全量扫描零误判、零字节变更。
- [ ] `npx vitest run` 全绿;`npx tsc --noEmit` 无错误。
- [ ] 修复后真实图片请求(含多图 `media index[1]` 形态)不再触发上游 `count_token_failed`。

## Non-goals

- 不修复 multipart 转发体拼接问题(独立缺陷,另行评估)。
- 不改动 `BASE64_TOKEN_RE` 规则本身(规则对真实文本仍有效;误判根因是"二进制 payload 被当作文本扫描",修复点在扫描入口)。
- 不做扫描器的性能优化或架构重构。