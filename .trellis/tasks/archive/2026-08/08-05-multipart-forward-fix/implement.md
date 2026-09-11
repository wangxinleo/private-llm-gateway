# Implement Plan — multipart-forward-fix

Task: `08-05-multipart-forward-fix`
PRD: `prd.md`

## Design

### 根因

route.ts 对 multipart 用 `collectMultipartText` 拼接文本作为转发体,文件丢失;`forwardRequest` 又保留了旧 boundary 的 content-type 头。

### 修复方案(route.ts + forwarder.ts)

**注意:实现中发现原始流转发有坑** —— `request.body`(ReadableStream)经 fetch 转发需要 `duplex: "half"`,否则报 `RequestInit: duplex option is required when sending a body`(实测 502)。因此 multipart 一律用 FormData 重建:内容完整(字段+文件),fetch 自动生成新 boundary,无需 duplex。

**1. 转发体决策(route.ts `handleRequest`)**

| 场景 | 当前 | 修复后 |
|---|---|---|
| multipart + allow | 拼接文本 | `await request.formData()`(原始 FormData,内容完整) |
| multipart + mask | 拼接文本(打码后) | `rebuildMaskedMultipart(request, findings)`(字段打码 + 文件原样) |
| multipart + bypass | 拼接文本(空串) | `await request.formData()`(原始 FormData) |
| JSON/text + allow | bodyText | 不变 |
| JSON/text + mask | applyDisambiguation(maskedBody) | 不变 |

- 新 helper `rebuildMaskedMultipart(request, findings)`: `request.clone().formData()` → 遍历 entries,字符串字段 `applyMasks(value, findings).masked`,File/Blob 原样 append → 返回新 `FormData`。
- 注意:route 里 multipart 只调用一次 `extractBodyText`(内部 clone),原始 `request` 的 body 流未被消费,allow/bypass 可再次 `request.formData()`。

**2. forwardRequest(forwarder.ts)**

- `init.body` 为 `FormData` 时,删除旧 `content-type` 头,让 fetch 自动生成 `multipart/form-data; boundary=<new>`(否则旧 boundary 与 body 不匹配)。
- 字符串 body 行为不变;`content-length` 删除逻辑不变。

**3. 不动**

- `collectMultipartText` / `parseMultipart` / `runPipeline` 扫描逻辑。
- `applyDisambiguation`(multipart 直接返回原值)。
- block 路径。

## Execution Checklist

### 1. 实现

- [ ] `src/proxy/forwarder.ts`:`body instanceof FormData` 时 `headers.delete("content-type")`。
- [ ] `src/app/api/[[...path]]/route.ts`:
  - 新增 `rebuildMaskedMultipart(request, findings): Promise<FormData>`(import `applyMasks` from `@/scanner/pii`)。
  - 重构转发体决策:multipart → allow/bypass 传 `undefined`,mask 传重建 FormData;非 multipart 维持现状。
  - bypass 分支的 `forwardRequest(path, request, hasBody ? bodyText : undefined)` 改为 multipart 时传 `undefined`。

### 2. 测试

- [ ] `src/__tests__/route-proxy.test.ts`(或新文件 `route-multipart.test.ts`)新增:
  - multipart + allow:`forwardRequest` 第三参为 `undefined`。
  - multipart + mask(文本字段含 `sk-...`):第三参为 `FormData`;重建后字符串字段含 mask tag;文件 entry 保留。
  - bypass + multipart:`forwardRequest` 第三参为 `undefined`。
  - multipart + block(敏感文件名):不调用 `forwardRequest`,返回 block 响应。
- [ ] 集成冒烟(mock 上游,不入库):multipart 含文件 + 密钥字段,上游收到合法 multipart、文件完整、字段打码。

### 3. 验证

- [ ] `npx vitest run` 全绿(345+ 既有 + 新增)。
- [ ] `npx tsc --noEmit` 无错误。
- [ ] 手工冒烟:mock-upstream.mjs + curl `-F` 上传文件,确认上游收到的 body 含文件内容。

## Review Gates

- [ ] R1(allow 原始体)、R2(mask 重建)、R4(bypass 原始体)通过。
- [ ] R5 非 multipart 零回归(全量测试)。
- [ ] 类型检查通过。

## Rollback

- 涉及 `route.ts` + `forwarder.ts` + 测试文件;`git checkout` 相关文件即可恢复。