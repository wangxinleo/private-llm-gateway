# 实施计划:性能调研

## 执行清单(顺序执行)

### Phase A:基准基建

- [ ] A1. 创建 `benchmarks/fixtures/proxy-payload.ts`:程序化生成类 `/v1/responses` JSON
  - [ ] messages 数组含多段长文本(代码/日志/JSON 片段)
  - [ ] 高价值字段(connection string、JWT、email)混入
  - [ ] 规模参数化:128KB / 278KB / 512KB / 1MB
- [ ] A2. 创建 `benchmarks/scan-bench.ts`:调用 `runPipeline` + 分项计时
  - [ ] warmup 轮(先跑 1 轮丢弃)
  - [ ] 输出 secrets/context-key/PII/JSON 解析/总耗时占比
  - [ ] 不写生产 audit 库(临时 DB_PATH 或纯函数调用)
- [ ] A3. `package.json` 新增 `bench` script;验证 `npm run bench` 可跑

### Phase B:基线测量

- [ ] B1. 跑 278KB 级基准,确认复现秒级耗时(>1s)
- [ ] B2. 跑 128KB / 512KB / 1MB 规模,记录耗时增长曲线
- [ ] B3. 记录各环节耗时占比到 `research/`(见下)

### Phase C:嫌疑点量化

- [ ] C1. 逐值扫描 N× 重复:统计 `scanStringContext` 调用次数(通过原型插桩或轻量计数器)
  - [ ] 对比"全文本/对象一次扫描"vs"逐值扫描"耗时差
  - [ ] 量化主战场(逐值重复)占比
- [ ] C2. 正则预过滤:测"前缀/长度预过滤后跑正则"vs"全量跑 30+ 正则"耗时差(若可隔离)
- [ ] C3. findings-only 路径:对比"完整 maskJsonBody(含脱敏+JSON 往返)"vs"仅扫描产出 findings"耗时差,量化 bypass 分支中"结果用不到"的部分
- [ ] C4. 小项量化(可选):applyMasks 计数、context-key encoded 嵌套解码
- [ ] C5. 将各嫌疑点结论写入 `research/`

### Phase D:原型验证

- [ ] D1. 创建 `src/scanner/json-mask-batch.ts`:`maskJsonBodyBatch`(批量扫描:对象/全文一次扫描 → findings 按值映射回 → 局部脱敏)
  - [ ] 与 `maskJsonBody` 同签名,findings/maskedBody **语义等价**(同一负载产出相同结果)
- [ ] D2. 基准脚本对比 `maskJsonBody` vs `maskJsonBodyBatch` 耗时与 findings 一致性(断言等价,不断言速度)
- [ ] D3. 记录原型收益到 `research/`

### Phase E:报告与收尾

- [ ] E1. 撰写 `research/perf-report.md`:根因结论、证据锚点、≥3 算法优化候选排序、检测语义等价性论证、是否值得修复建议
- [ ] E2. 跑 `npm test` 确认无回归(新增文件不影响现有测试)
- [ ] E3. 跑 `npm run build` / `tsc --noEmit` 确认类型检查通过
- [ ] E4. 更新 PRD 勾选 AC1-AC5

## 验证命令

```bash
npm run bench          # 基准脚本(Phase A 后可用)
npm test               # 回归验证(Phase E)
npx tsc --noEmit       # 类型检查
npm run build          # 构建验证
```

## 风险文件与回滚点

- 新增文件:`benchmarks/`、`src/scanner/json-mask-batch.ts` → 无回滚压力
- 唯一触碰的现有文件:`package.json`(新增 bench script)→ 可独立回滚
- **不触碰**:`route.ts`、`pipeline.ts`、`secrets.ts`、`context-key.ts`、`pii.ts`

## 调研前置检查

- `task.py start` 前:PRD 已含 D1-D7 决策、AC 已定义、design.md + implement.md 已就绪
- 调研产出必须写入 `research/` 文件,不留在聊天(规范)
- 若基准发现需调整负载形态或原型范围,回到 Phase 1 修订 PRD 再继续