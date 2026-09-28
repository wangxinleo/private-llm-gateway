# design.md — 通知样例语义化（现象② / D1）

## 概览与边界

单点改动：`src/proxy/disambiguation.ts` `buildNotice`（57-62）——通知样例从旧格式 `<<PRIVACY_MASK:CATEGORY>>` 改为**本请求实际签发**的 `{{...}}` 标签，并统一替换通知文本中两类示例形态。

不改动：通知注入落点与判定条件（309-321）、占位符文法（TAG_RE/LOOSE_RX）、HMAC 后缀派生、还原协议、bypass/fail_closed/规则开关语义、DB schema、环境变量、自定义词短码逻辑（现象①已复核为非缺陷，不修）。

## 现状

```ts
// disambiguation.ts:57-62（现状）
const sampleTag = scanResult.maskSummary.categories[0]
  ? `<<PRIVACY_MASK:${scanResult.maskSummary.categories[0]}>>`
  : "<<PRIVACY_MASK:TYPE>>";
return PRIVACY_NOTICE_TEXT.replace(/<<PRIVACY_MASK:\w+>>/g, sampleTag);
```

默认通知文本（config.ts:101-102）自带两个示例：`{{EMAIL_trwmq}}`（语义）与 `<<PRIVACY_MASK:EMAIL>>`（旧格式）。现状只替换后者，且替换目标仍是旧格式 → 通知向模型示范的两种形态中一种是不可还原的旧格式（探针复现见 research/probe-evidence.md）。

## 目标形态

```ts
// 样例 = 本次 registry 首个签发的真实标签；registry 非空由调用方保证（disambiguation.ts:311）
const sampleTag = scanResult.registry?.tagToValue.keys().next().value ?? "{{EMAIL_trwmq}}";
const NOTICE_SAMPLE_RE = new RegExp(`${TAG_RE.source}|${EXPLICIT_TAG_RE.source}`, "g");
return PRIVACY_NOTICE_TEXT.replace(NOTICE_SAMPLE_RE, sampleTag);
```

- 复用 mask-tag.ts 导出的 `TAG_RE` / `EXPLICIT_TAG_RE`（单一事实源）。替换只作用于服务端通知文本（非请求体 / 用户输入），无 regex-performance-guide 所指的请求侧 O(n²) 攻击面。
- **两种示例形态统一替换为一个真实标签**：通知只示范一种形态，与请求体所见完全一致；模型若回显该样例 → 命中 registry → 正常还原（与"正确回填"语义一致，不留不可还原字面）。
- fallback `{{EMAIL_trwmq}}` 仅为代码完整性（registry 空时 309-311 已提前返回，不可达）。

## 不变式与边界

| 情形 | 行为 |
|---|---|
| mask 未应用 / registry 空 / legacy 模式 | 不注入（309-311 既有守卫，不变） |
| multipart | 不注入（312，不变） |
| 注入落点（JSON 各协议面 / 文本后缀） | 完全不变（316-321） |
| 用户 env 覆盖通知、无示例占位符 | 替换零命中，通知原样（无旧格式可泄漏） |
| 用户 env 覆盖通知、含旧格式示例 | 被替换为语义真实标签（符合要求） |

## 测试计划

- 在既有 `src/__tests__/disambiguation.test.ts` 追加「notice samples (semantic mode)」用例组（确定性后缀 registry `() => "bcdfg"`）：
  - 默认通知：两种示例形态均替换为真实签发标签；注入文本无 `<<PRIVACY_MASK:` 与 `[CATEGORY]` 形态；
  - CUSTOM_TERM 场景（词条 gffund + 短码 GFFUND）通知不含 `<<PRIVACY_MASK:CUSTOM_TERM>>`；
  - 回显示例经 restoreText 精确还原为原值；
  - text/plain 后缀注入无旧格式；
  - env 覆盖通知文本中的旧格式示例同样被替换（vi.resetModules + 动态 import）。
- 不注入不变量（无掩码 / applied=false / 无 registry / multipart）由该文件既有用例覆盖，不重复。
- 全套回归：`npm test`。

## 服务端复测（现象②，交付后用户侧执行）

1. 水印探针（含 `gffund`、`{{EMAIL_trwmq}}`）经服务器实例往返：
   - 上游可见载荷（如有 DEBUG/审计透出）无 `<<PRIVACY_MASK:`（含 `<<PRIVACY_MASK:CUSTOM_TERM>>`）；通知样例为 `{{...}}` 形态；
   - 客户端输出无旧格式字面。
2. 现象①已按用户复核闭环（正确还原，非泄漏），不设排查项。

## Rollback

纯代码改动，无 schema/协议/数据迁移；回滚 = revert 提交并重新部署。部署前可先在本地以 test DB 起 dev 实例做链路自测。
