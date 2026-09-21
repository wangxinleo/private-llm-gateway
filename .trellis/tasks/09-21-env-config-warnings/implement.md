# Implement — 非法配置值可见化

## 步骤

- [x] 1. 测试先行 `src/__tests__/env-check.test.ts`（合法矩阵 / 非法逐项 / 旧值 / 短密钥 / stderr / once 守卫）。
- [x] 2. 新增 `src/lib/env-check.ts`：`collectEnvWarnings` + `warnInvalidEnv`（Logger.warn → stderr）。
- [x] 3. `config-loader.ts` `initializeConfigs()` 挂接（once 守卫内，每进程一轮）。
- [x] 4. 全量 `npm test` + `npm run build` 绿。
- [x] 5. spec：env 校验契约与两个 `==="1"` 型变量的告警语义写入 reverse-proxy.md 环境变量节。
- [x] 6. 提交 + 归档。

## 验证命令

```bash
npx vitest run src/__tests__/env-check.test.ts
npm test && npm run build
```

## 回滚点

- 纯告警路径（不改变解析结果）：回滚 = 移除 env-check 模块与 initializeConfigs 一行挂接。
