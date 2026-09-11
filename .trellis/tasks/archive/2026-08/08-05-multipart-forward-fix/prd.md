# 修复 multipart 请求转发体拼接导致文件内容丢失

## Goal

消除 multipart 请求转发时文件内容丢失的问题。当前网关对 `multipart/form-data` 请求,转发给上游的 body 是 `collectMultipartText` 拼接出的纯文本(仅字符串字段,"key=value&key2=..." 形态),文件 blob 被丢弃,且保留了原始 `multipart/form-data; boundary=...` 头——上游收到"multipart 头 + 无 boundary 纯文本体",解析必然失败。修复后 multipart 请求必须把**原始文件内容原样转发**;文本字段命中脱敏规则时,在保留文件的前提下重建 multipart 体。

## Background

- 实测确认(2026-08-05,本地 mock 上游):发送 `message=hello world` + 文件 `fake.png`(内容 `fake binary content 12345`),上游收到的 body 为 `"message=hello world"`,文件内容丢失、无 boundary。
- 根因在 `src/app/api/[[...path]]/route.ts`:
  - multipart 时 `bodyText = collectMultipartText(parseMultipart(request))`,只保留字符串字段,文件丢弃;
  - `forwardBody = hasBody ? bodyText : undefined` 把拼接文本作为转发体;
  - `forwardRequest` 保留原始 multipart content-type 头(boundary 与 body 不匹配)。
- 该问题同时存在于 bypass 分支:multipart + bypass 时 `forwardRequest(path, request, bodyText)` 同样发送拼接文本(此时 bodyText 为空字符串)。
- 现有扫描语义保持不变:multipart 的扫描基于拼接文本(字符串字段)+ 文件名检查;修复只改变"扫描后如何转发"。
- 相关既有能力:`applyDisambiguation` 对 multipart 直接返回原 maskedBody(不注入通知),此行为保持不变;multipart 的 block 判定(敏感文件名)走既有 `blockedResponse` 路径。
- 上游 `fetch` 原生支持 `FormData` body,会自动生成正确的 boundary 与 content-type;原始 `request.body` 未被消费(`extractBodyText` 内部使用 `request.clone()`),multipart allow 时可原样转发。

## Requirements

### R1. multipart 且无命中(allow)

转发**原始 multipart body**(文件与字段原样、boundary 一致),而不是拼接文本。上游收到的 body 必须与客户端发送的逐字节一致(或多部分内容完整)。

### R2. multipart 且命中脱敏(mask)

重建 multipart 体:字符串字段应用 mask(与扫描 finding 一致),文件部分原样保留;转发体必须是合法 multipart(fetch 自动生成 boundary 与 content-type)。通知注入(`applyDisambiguation`)对 multipart 不生效,维持现状。

### R3. multipart 且命中 block

维持现状:敏感文件名等 block 类命中直接返回 `blockedResponse`,不转发。

### R4. bypass + multipart

bypass 命中时转发原始 multipart body(非拼接文本、非空字符串)。

### R5. 非 multipart 路径零回归

JSON / text / urlencoded 请求的扫描、mask、转发行为完全不变;`forwardRequest` 对字符串 body 的行为不变。

### R6. 可验证

- 单元级:route 测试断言 multipart allow 时 `forwardRequest` 收到 `undefined`(走原始 body);multipart mask 时收到重建的 `FormData`,且字符串字段已打码、文件保留。
- 集成级(mock 上游):multipart 请求端到端后,上游收到的 body 是合法 multipart,文件内容完整;文本字段含密钥时,上游收到打码后的字段值。
- 全量测试(345+)通过,`tsc --noEmit` 无错误。

## Acceptance Criteria

- [ ] multipart + allow:上游收到完整原始 multipart 体(实测文件内容 `fake binary content 12345` 完整到达)。
- [ ] multipart + mask:上游收到合法 multipart,文本字段已打码,文件内容完整。
- [ ] bypass + multipart:上游收到原始 multipart 体,非空字符串。
- [ ] multipart + block(敏感文件名):仍返回 `blockedResponse`,不转发。
- [ ] 非 multipart 路径既有测试全绿(345+),`npx vitest run` 与 `npx tsc --noEmit` 通过。
- [ ] route 层新增单测覆盖上述 allow/mask/bypass 三种转发形态。

## Non-goals

- 不改变 multipart 扫描逻辑(仍扫描拼接文本 + 文件名)。
- 不实现 multipart 的通知注入(`applyDisambiguation` 维持 multipart 直接返回)。
- 不处理"finding 跨字段拼接边界"的边界情况(单字段内命中即打码;跨字段命中记入审计但不打码,现网概率极低)。
- 不涉及图片 base64 误判问题(已在 `08-05-image-base64-false-positive-fix` 修复)。