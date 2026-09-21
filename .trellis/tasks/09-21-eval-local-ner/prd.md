# 评估：本地 NER 语义实体识别（Node/Next 网关）

## Goal

评估在本项目（Next.js standalone 单容器网关）内引入本地 NER（人名/机构/地址等自由文本语义实体）的收益、成本与风险，产出 go/no-go 结论与可执行实施草图。本任务不写生产代码、不改变任何现有行为。

## Background / 差距

- 我方 PII 覆盖为 12 条结构化规则（`pii.ts:135-148`）：手机/邮箱/身份证/银行卡/座机/车牌/IPv4 私网/IBAN/USCC/MAC/HKID + 自定义词库。**自由文本人名、机构、地址无自动覆盖**；现有替代是用户手工维护词库（`CUSTOM_TERM`）。
- 竞品证据（maskit 2026-09-19 v0.3.0）：本地 ONNX 中文 BERT NER，默认关；其样例集"规则 + NER"将明文残留从 74% 降到 11%；为分发模型专门增加 CI 步骤（All-in-One 包拉取并打包模型）；NER 接入过程踩出"实体残片明文上行"（NER 在已脱敏文本上跑）等硬坑。

## Deliverable

`research/local-ner-assessment.md`：选项对比、成本/收益、风险、go/no-go、实施草图与验证方法。

## Requirements

- R1 选项对比（至少 4 条：onnxruntime-node / transformers.js(WASM) / 独立 sidecar 进程 / 暂不做），含部署形态与维护成本。
- R2 量化约束：模型体积、镜像增量、内存、CPU 延迟、长文本分块策略；未实测数字必须标注"量级估计/待验证"。
- R3 风险：中英混排与代码误报、版本串误伤、与单遍脱敏架构的交互（必须论证是否复现 maskit 的坐标漂移问题）、隐私边界（本地推理、无外发）。
- R4 借鉴映射：maskit 的优先级契约（规则/自定义词 > NER）、非汉字跳过、协议控制键保护、OffsetMap 教训逐条映射到本架构的落法。
- R5 结论：go/no-go + （若 go）实施草图（模型选型、打包、开关、测试与性能门槛）与验证方法；若 no-go，写明触发条件与前置调研项。

## Acceptance Criteria

- [ ] AC1 文档包含 R1-R5 全部要素，结论明确，未验证事实显式标注。
- [ ] AC2 不写生产代码、不改依赖、不改配置；`npm test` 与 `npm run build` 与评估前一致（无代码变更即成立）。
- [ ] AC3 结论可被父任务集成复核（与 T4/T6 的评估格式一致）。

## Out of Scope

- NER 生产实现（若 go，另立实现任务）；模型训练/微调；云侧 PII 服务。
