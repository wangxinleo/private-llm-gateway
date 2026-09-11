# 执行计划:下行无感还原

## 前置

- [ ] 阅读 spec:backend/reverse-proxy.md、backend/performance.md、guides/regex-performance-guide.md

## 实施清单(有序)

1. [ ] `src/scanner/mask-registry.ts`:MaskRegistry(tagFor 值级去重 + 随机辅音后缀冲突重掷 / tagToValue / size / 防套娃反查)+ 单元测试
2. [ ] `src/scanner/mask-tag.ts`:类别短码白名单 + v3 语义格式构造({{CODE_SUF5}} 随机纯辅音后缀)、严格 TAG_RE / PARTIAL / 宽松修复 LOOSE_RX(新格式 + 旧 explicit/legacy 只读模式)、最长 tag 长度常量(纯函数)
3. [ ] `src/scanner/pii.ts`:applyMasks 接收/返回 registry,按 registry.tagFor 分配实例 tag;叠加替换按占位符切段,仅替换非占位符片段
4. [ ] `src/scanner/json-mask.ts`:内联 replaceAll 收敛到 applyMasks,共享 registry
5. [ ] `src/scanner/pipeline.ts`:registry 参数透传,ScanResult 携带 registry(types.ts 增量)
6. [ ] `src/proxy/restore.ts`:restoreText + SseChannelRestorer(帧拆分 / 通道化 pending / 跨事件拼接 / flush 补发 / 宽松修复 degraded 计数)+ 单元测试(切分/跨事件/假前缀/EOF/多字节/相邻/洪泛/未命中/旧格式/宽松修复/通道隔离)
7. [ ] `src/proxy/streaming.ts`:createStreamingResponse 增加可选 restorer,字节→拆帧→通道化还原→重组帧路径
8. [ ] `src/app/api/[[...path]]/route.ts`:registry 创建与贯通;响应分支接入还原(SSE/JSON/文本;二进制旁路)
9. [ ] 消歧改造为极简指令(D4 v3):PRIVACY_NOTICE_TEXT 默认值替换为一行保真指令(无原文);PRIVACY_DISAMBIGUATION_MODE 收敛为 auto|off(旧值 prefix/json-meta 兼容解析为 auto);注入门控 registry 非空;更新 disambiguation.test.ts
10. [ ] 更新受影响既有测试断言(样例 → 语义格式;disambiguation 断言 → 一行指令门控)
11. [ ] e2e:脱敏→回显→还原 roundtrip(SSE + JSON + tool_calls)+ 上游零泄漏断言(原文计数为 0)+ 指令门控断言 + 剥括号宽松修复用例
12. [ ] 全量回归

## 验证命令

```bash
npx vitest run                # 全量
npx vitest run src/__tests__/mask.test.ts src/__tests__/streaming.test.ts   # 焦点
npx tsc --noEmit              # 类型
```

## 风险文件与回滚点

- 高风险:route.ts(主链路)、streaming.ts(流式)——每步独立提交,步骤 8 前所有改动对现有行为无影响(registry 未接线)。
- 回滚:单 commit revert;无状态、无迁移、无新增环境变量。

## 完成门

- [ ] AC1–AC10 全部有对应测试且通过
- [ ] lint / typecheck 通过
