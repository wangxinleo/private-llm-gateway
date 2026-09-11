# Implement Plan — image-base64-false-positive-fix

Task: `08-05-image-base64-false-positive-fix`
PRD: `prd.md`

## Design

### 根因

`maskJsonBody` 对 JSON 中每个字符串值调用 `scanStringContext` 并扫描;`BASE64_TOKEN_RE` 会把 base64 二进制数据里的 `eyJ`+40+ 序列误判为 token,`maskStringValue` 将其替换为含 `<` 的 mask tag,破坏 base64。

### 修复点(单一入口,不动规则本身)

在 `src/scanner/json-mask.ts` 的 `scanValue` 字符串分支,对以下两类值**跳过扫描、原样返回**:

1. **Data URI**:`/^data:[a-zA-Z0-9+.-]+\/[a-zA-Z0-9+.-]+;base64,/` —— 覆盖 OpenAI `image_url.url`、文件/音频/视频 data URI。
2. **裸 base64 二进制字段**:键名(`path.at(-1`)为 `data` 且值为纯 base64(`/^[A-Za-z0-9+/]+={0,2}$/`)且长度 ≥ 64 —— 覆盖 Anthropic `source.data`(键名恰好是 `data`)与 Gemini `inline_data.data`。

选型理由:
- **为什么不用"纯 base64 长串一律跳过"**:会误伤用户粘贴在普通文本字段(如 `text`)里待分析的 base64 token,降低 R3 要求的扫描覆盖。
- **为什么限定键名 `data`**:Anthropic/Gemini 的二进制字段在真实 API 形态中键名就是 `data`;`{"data": <长纯base64>}` 在 LLM 请求里没有其他语义。`text`、`content` 等键名维持原扫描行为。
- **为什么阈值 64**:`BASE64_TOKEN` 命中至少 43 字符,64 保证只覆盖"明显是二进制 blob"的值,且远小于 data URI 判定。

### 不动的部分

- `BASE64_TOKEN_RE` 规则、`secrets.ts`、`pipeline.ts`、`route.ts` 均不改。
- multipart 转发体拼接问题不在本任务范围(见 PRD Non-goals)。

## Execution Checklist

### 1. 实现

- [ ] `src/scanner/json-mask.ts`:新增 `isDataUri(value)` 与 `isBase64BlobValue(value)`,在 `scanValue` 字符串分支顶部短路:命中则 `return value`(不产生 finding、不参与 block 判定)。
- [ ] 保持 `scanStringContext` / `scanObjectContext` 其余逻辑不变。

### 2. 测试

- [ ] `src/__tests__/json-mask.test.ts`(或新增 `image-base64.test.ts`)新增:
  - data URI(强制注入 `eyJ`+45 字符)图片请求 → `action: "allow"` 且 body 逐字节不变、无 finding。
  - Anthropic `source.data` 裸 base64 含 `eyJ`+45 → 同上。
  - Gemini `inline_data.data` 同上。
  - 回归:文本中 `sk-...`、JWT、`Bearer` 仍被打码;`text` 键下长 base64(`eyJ`+45)仍被 `BASE64_TOKEN` 打码(证明未降级)。
- [ ] 本地批量验证(临时脚本,不入库):500 张随机 PNG(≥22.5KB base64)走完整 `maskJsonBody` → 零 finding、零字节变更。

### 3. 验证

- [ ] `npx vitest run` 全绿。
- [ ] `npx tsc --noEmit` 无错误。
- [ ] 手工冒烟:`mock-upstream.mjs` 起上游,curl 一个含 data URI 图片(内嵌 `eyJ`+45)的 chat completions 请求,确认转发体未被改写、上游正常响应。

## Review Gates

- [ ] R1/R2 通过:二进制 payload 零变更。
- [ ] R3 通过:文本密钥扫描覆盖不降级(回归测试证明)。
- [ ] 全量测试 + 类型检查通过。

## Rollback

- 单文件改动(`json-mask.ts` + 测试文件);若回归,`git checkout` 该文件即可恢复。