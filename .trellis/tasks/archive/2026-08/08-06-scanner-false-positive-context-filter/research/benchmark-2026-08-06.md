# 性能基准:旧全文扫描 vs 新窗口扫描

日期:2026-08-06
负载:278.2 KB(prose 文本 + commit sha + prose URL + 白名单账户名/域名)
运行:`npx tsx benchmarks/scan-compare.ts`

## 结果

| 指标 | 旧全文扫描 | 新窗口扫描 | 提升 |
|---|---|---|---|
| 耗时 | 20.5 ms | 10.3 ms | **1.98x** |
| findings | 0 | 1(D7 抓严检出 commit sha) | — |

## 组成分解(scan-profile)

- `scanSecrets(text)`: 2.2 ms(全局高信号前缀层,不可关闭)
- `scanPii(text)`: 4.2 ms(全文 PII,用户确认保留)
- `locateSensitiveHits`: 11.7 ms → 优化后 ~0.5 ms(单遍敏感键名正则,替代 7 正则 KV 提取)
- `locateHighRiskAssets`: 1.6 ms

## 优化历程

1. 初版:每窗口调 `scanSecrets(window)`(30 正则)+ `locateSensitiveHits` 全文 7 正则 KV 提取 → 20.4 ms(0.93x,退化)
2. `locateSensitiveHits` 改用单遍敏感键名正则(由 SECRET_KEYS/ENDPOINT_KEYS/IDENTITY_KEYS/ENCODED_KEYS 集合生成,`(?<![A-Za-z0-9])` 边界 + `[\s_.-]*` 归一化分隔符)→ 11.6 ms(1.63x)
3. 窗口内 secrets 跳过全局已覆盖值(`globalSecretValues` 集合)→ 10.3 ms(1.98x)

## 结论

- 新范式性能主成本 = 全局 PII 全文(4.2ms)+ 全局 secrets(2.2ms)+ 单遍键名定位(~0.5ms),均与 payload 大小线性,但**无旧的"全文 × 全管道"重复扫描**。
- 线上 251KB allow 请求 245ms 的根因(全文 × 逐值扫描)在新范式下不存在。
- AC5 达成:新窗口扫描对 278KB 负载耗时低于旧全文扫描。
