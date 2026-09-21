# 实现：IPV6_PRIVATE 内置规则（默认关）

## Goal

补齐内网 IPv6 覆盖：识别 fe80::/10（链路本地）与 fc00::/7（ULA）地址并在请求侧脱敏；默认关，避免含冒号 hex 串误报。

## Background

- 竞品依据：maskit `f1e8fc2` 新增 `IPV6_PRIVATE`（默认关），附两条实现纪律。
- 我方现状：`pii.ts` 的 IP 系规则只有 IPv4（`IP_PRIVATE` 默认开 / `IP_INTERNAL` 默认关）。
- maskit 纪律（逐条采纳）：
  1. **不用 `IPv6Address.is_private`**（会把 2001:db8::/32 文档段、::1 环回也算 private → 公网讨论文本误脱）；只认 fe80::/10 与 fc00::/7；
  2. zone id（`fe80::1%eth0`）解析前剥离；
  3. 关键词预过滤用 `fe8/fe9/fea/feb/fc/fd` 前缀（用 `:` 做特征会在任何 URL/JSON 上全量跑宽正则）；**必须大小写不敏感**（maskit 实测 `Fe80::1` 混合大小写导致整条规则被静默跳过）；
  4. 宽候选正则 + 语义校验保证只脱私网段（MAC `aa:bb:..`、版本串、端口串被解析剔除）。

## Requirements

- R1 `FindingCategory` 增加 `IPV6_PRIVATE`；`DEFAULT_RULE_TOGGLES` 默认 `false`；短码 `IPV6PRIV`；规则 UI 分类清单加入。
- R2 候选正则（照 maskit，边界断言不得排除 `:`，保证 `IPV6:fe80::1` / `gateway:fd00::5` 键值形态可命中）：`(?<![0-9A-Fa-f.])[0-9A-Fa-f:]{2,45}(?![0-9A-Fa-f:])`。
- R3 语义校验：剥离 `%zone` → 手写 IPv6 解析（支持 `::` 压缩；8 组；无 `::` 时组数必须为 8）→ 首组 ∈ [0xfe80,0xfebf] ∪ [0xfc00,0xfdff]。
- R4 预过滤（必要条件，`text.toLowerCase()` 后）：含 `:` 且含 `fe8|fe9|fea|feb|fc|fd` 之一。
- R5 正负用例：fe80::1 / fc00::5 / fd12:3456::1 / 大小写混合 / zone id / 方括号包裹 / 键值形态命中；2001:db8::1、::1、公网、MAC、无冒号串、版本串不命中；默认关、开启后生效。
- R6 与窗口扫描/字节级 splice 的既有语义不变（新规则只增 findings）。

## Acceptance Criteria

- [ ] AC1 正例（含 `IPV6:fe80::1`、`Fe80::1%eth0`、`[fd00::5]`）命中且脱敏为 `{{IPV6PRIV_xxxxx}}`。
- [ ] AC2 反例（文档段/环回/公网/MAC/无冒号）零命中；大小写与 zone 变体一致处理。
- [ ] AC3 默认关：默认配置下不产生 findings；开启后立即生效（`SCANNER_RULES` 热切换）。
- [ ] AC4 全量 `npm test` 绿 + `npm run build` 绿。

## Out of Scope

- 公网 IPv6 检测（误伤面大，暂不做）；IPv4 系规则行为不变。

## Open Questions

（无）
