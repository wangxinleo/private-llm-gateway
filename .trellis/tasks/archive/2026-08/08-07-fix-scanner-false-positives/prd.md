# 修复扫描器上线后大量误报

## 问题现象

上线后单次请求拦截 87 项:CONTEXTUAL_SECRET ×81、EMAIL ×2、ID_CARD ×4。
大量普通 API 字段名、URL、hex 编码数据被误判为敏感。

## 根因分析

### 问题 1: scanChaosTokens 过度激进(81 误报的主犯)

`context-window.ts` 中 `scanChaosTokens` 用 `/\b[A-Za-z0-9_\-]{8,}\b/g` 匹配所有 8+ 字符混合 token,然后 `isChaosToken` 仅排除:
- 纯字母(`PURE_WORD_RE`)
- 纯数字(`PURE_DIGITS_RE`)
- 重复字符(`REPEATED_RE`)
- 少量已知词(`KNOWN_PLAINTEXT`)

导致 `content_type`、`request_id`、`display_url`、`session_id`、`tool_calls`、`background_output`、`include_transcript`、`cost_extract`、`mega_search` 等普通 API 字段名全部被标记为 CONTEXTUAL_SECRET。

### 问题 2: locateSensitiveHits 窗口触发面太广(放大器)

`context-key.ts` 中 `SENSITIVE_KEY_RE` 由 SECRET_KEYS + ENDPOINT_KEYS + IDENTITY_KEYS + ENCODED_KEYS 全部键名生成。
其中 ENDPOINT_KEYS 包含 `url`、`host`、`server`,IDENTITY_KEYS 包含 `session`、`auth`、`account` 等。
每个 LLM API 请求体都含这些键 → 每个开 200 字符窗口 → 窗口几乎覆盖全文 → chaos scanner 扫描全文。

### 问题 3: ID_CARD 正则无校验(4 误报)

`pii.ts` 中 `/\d{17}[\dXx]/g` 匹配任意 18 位数字串。hex 编码数据、时间戳、UUID 等全部命中。
BANK_CARD 有 luhnCheck,ID_CARD 无任何校验。

## 修复方案

### Fix A: 移除 scanChaosTokens(核心修复)

chaos token 扫描的假阳性远高于真阳性——8+ 字符混合 token 在正常 API 请求中几乎都是字段名/标识符,不是密钥。
密钥检测已由 `scanSecrets`(权威正则)和 `scanContextKey`(键值对 + 值校验)覆盖。
移除 `scanChaosTokens` 函数及其在 `scanContextWindows` 中的调用。

### Fix B: 窗口触发收窄——仅 SECRET_KEYS + ENCODED_KEYS 触发

`locateSensitiveHits` 当前用全部四类键触发窗口。改为仅 SECRET_KEYS + ENCODED_KEYS 触发:
- ENDPOINT_KEYS(`url`/`host`/`server`)和 IDENTITY_KEYS(`session`/`auth`/`account`)太常见,不应用作窗口锚点
- 这些键的值仍由 `scanContextKey` 在窗口内扫描,只是不再自己开窗口

### Fix C: ID_CARD 加校验

参照 GB 11643-1999,加入身份证号校验码验证(加权因子 + 模 11 校验)。

## 验收标准

- [ ] `scanChaosTokens` 函数及其调用已移除
- [ ] `locateSensitiveHits` 仅用 SECRET_KEYS + ENCODED_KEYS 生成正则
- [ ] ID_CARD 加入校验码验证,非身份证号不命中
- [ ] 现有 351 测试全绿(更新因 chaos/窗口变更受影响的测试)
- [ ] `tsc --noEmit` 干净
- [ ] `npm run build` 通过
- [ ] 用户报告的误报场景(content_type、request_id、display_url 等)不再被标记

## 约束

- 不破坏 scanSecrets 和 scanContextKey 的既有行为
- PHONE/ID_CARD/BANK_CARD 全文扫描保留
- EMAIL 窗口内扫描保留
- 白名单资产触发窗口保留
