# 执行清单：整理测试目录并清理根目录冗余文件

> 执行记录（2026-09-17）：全部完成。执行中发现 2 个计划外的同类根因并已修复：
> (a) 6 个 route 测试经真实 `insertSignals` 在仓库根建 `audit.sqlite`——`vitest.setup.ts` 兜底 `DB_PATH` 到 tmpdir；
> (b) `admin-audit.test.ts` 夹具滞后于 `AuditRow` 新增的 `mask_*` 三字段（9/15 引入）导致 `tsc` 报错——补齐夹具字段。

## 预检

- [x] `git status` 干净（执行前：clean，master）。
- [x] `data/`（dev server PID 持锁）与 `.env` 全程未动。

## D1 目录收敛（git mv 保留历史）

- [x] `git mv benchmarks src/__tests__/benchmarks`（4 个 .test.ts，rename 记录保留）
- [x] `mkdir -p src/__tests__/manual` + `git mv integration-test.sh` + `git mv mock-upstream.mjs` → `src/__tests__/manual/`

## D2 引用修正

- [x] `scan-compare.test.ts` / `apply-masks-scaling.test.ts` / `scan-latency-real.test.ts`：`../src/...` → `@/...`
- [x] `restore-bench.test.ts`：已是 `@/`，未动
- [x] `package.json`：`bench` → `vitest run src/__tests__/benchmarks/scan-compare.test.ts`
- [x] `README.md` / `README.zh-CN.md`：mock-upstream 指引更新为新路径
- [x] `.trellis/spec/guides/regex-performance-guide.md:61`：benchmarks 引用更新
- [x] `scan-latency-real.test.ts` 对 `真实请求.md` 的 CWD 相对读取语义不变（缺失时跳过）

## D3 e2e 卫生修复（根因）

- [x] `TEST_DB = join(tmpdir(), \`integration-test-${process.pid}\`, "audit.sqlite")`；`beforeAll` 前置 `mkdirSync`
- [x] `removeTestDb()` → `cleanupTestDir()`：`rmSync(TEST_DIR, { recursive, force })`（beforeAll + afterAll）
- [x] `grep test-integration-audit src/` 无残留引用

## D3.5 执行中追加的同类修复

- [x] `vitest.setup.ts`：`process.env.DB_PATH ||= join(tmpdir(), \`vitest-audit-${process.pid}.sqlite\`)`——根治未 mock `@/config` 的用例（route 测试经 `insertSignals`）在仓库根建库
- [x] `admin-audit.test.ts` 夹具补 `mask_applied: 0 / mask_categories: null / mask_count: null`（修复 pre-existing TS2739 ×3；`mask_count` 用 null 以保持路由映射输出与既有断言一致）

## D4 删除（用户已确认清单）

- [x] `.env.test-scenario` 内容已在会话粘贴留档后删除
- [x] 根目录 9 个 `test-*.sqlite*`（test-audit / test-e2e / test-quick / test-integration-audit 残留）
- [x] `tsconfig.tsbuildinfo`（后续 tsc 运行会按需重建，属构建缓存正常行为）
- [x] 根 `audit.sqlite(+shm/wal)`

## V 验证（2.2 质量检查）

- [x] V1 `npx tsc --noEmit` 通过（exit 0）
- [x] V2 `npm test` 全绿：44 passed | 1 skipped 文件；478 passed | 9 skipped 用例（e2e 文件因本机并发 dev server 持项目锁被跳过并入 baseline，CI 无并发时真实执行）
- [x] V3 `npm run bench` 新路径通过（1 file / 1 test）
- [x] V4 全量测试后根目录零新增 sqlite/临时物；`ls` 确认 `benchmarks/`、`integration-test.sh`、`mock-upstream.mjs` 已不在根
- [x] V5 `data/` 与 `.env` 未动

## 回滚点

- D1–D3 全部为跟踪文件改动，`git checkout` / `git mv` 可逆。
- D4 不可逆且已获用户确认；均为可再生（测试残留 / 构建缓存）或已留档（`.env.test-scenario`）。
