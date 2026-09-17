# 整理测试目录并清理根目录冗余文件

## Goal

将散落的测试资产统一收敛到 `src/__tests__/`，修复 e2e 测试向仓库根写 sqlite 的卫生问题，删除根目录历史测试残留与可再生产物，使根目录只保留源码、配置与运行数据。

## Background

现状盘点（2026-09-17）：

- 单测 45 个位于 `src/__tests__/`；基准 4 个位于根 `benchmarks/`；根目录另有 `integration-test.sh`（curl 手测脚本）与 `mock-upstream.mjs`（mock 上游，README 手测指引引用）。
- 根目录残留（均 gitignore、未跟踪）：
  - `test-audit.sqlite-shm/-wal`、`test-quick.sqlite-shm/-wal`——更早测试版本遗留，无主文件、无代码引用；
  - `test-e2e.sqlite(+shm/wal)`——旧 e2e 版本遗留；
  - `test-integration-audit.sqlite-shm/-wal`——当前 e2e 每轮残留。
- e2e 根因：`src/__tests__/integration/e2e.test.ts:9` `TEST_DB = "./test-integration-audit.sqlite"` 相对 CWD=仓库根，且 `removeTestDb()` 只 unlink 主文件，shm/wal 常驻。其余单测已统一 `tmpdir()` 模式（response-analysis/retention/channels/custom-words）。
- 根 `audit.sqlite*`：旧默认运行库（`src/config.ts:3` 默认 `audit.sqlite`）；当前 `.env` 已 `DB_PATH=./data/test-audit.sqlite`，活跃库在 `data/`（dev server PID 持锁）。
- `tsconfig.tsbuildinfo`（构建缓存，自动重建）；`.env.test-scenario`（7/3 遗留，无任何脚本引用，当前 `.env` 已是等价场景配置）。
- `vitest.config.ts` / `vitest.setup.ts` 属 vitest 工具配置，按约定保留在根，不属于测试资产。
- `.trellis/spec/shared/code-quality.md` 已约定集成测试目录为 `src/__tests__/`，本次收敛与该约定一致。

用户已确认（2026-09-17）：

- 收敛目标目录 = `src/__tests__/`；
- 删除范围 = 全部推荐项（test 残留 9 个 + `tsconfig.tsbuildinfo` + 根 `audit.sqlite*` 3 个 + `.env.test-scenario`），删除前 `.env.test-scenario` 内容在会话中留档。

## Requirements

- R1 目录收敛（`git mv` 保留历史）：
  - `benchmarks/`（4 个 .test.ts）→ `src/__tests__/benchmarks/`；
  - `integration-test.sh`、`mock-upstream.mjs` → `src/__tests__/manual/`。
- R2 引用修正：
  - 移动后 benchmark 文件内 `../src/...` 相对导入改为 `@/` 别名（3 个文件；`restore-bench.test.ts` 已是 `@/`）；
  - `package.json` `bench` 脚本路径更新；
  - `README.md` / `README.zh-CN.md` 中 `node mock-upstream.mjs` 更新为新路径；
  - `.trellis/spec/guides/regex-performance-guide.md:61` 的 `benchmarks/scan-latency-real.test.ts` 引用更新；
  - `scan-latency-real.test.ts` 对 `真实请求.md` 的 CWD 相对读取保持可用（vitest 从仓库根运行，不入库的敏感抓包缺失时用例跳过）。
- R3 e2e 卫生修复：`TEST_DB` 改为 `tmpdir()/integration-test-${pid}/` 下绝对路径（对齐现有 tmpdir 模式，含 `mkdirSync`）；清理改为整目录 `rmSync`，根治 shm/wal 残留。
- R4 删除（用户已确认）：根 `test-audit.sqlite-shm/-wal`、`test-e2e.sqlite*`、`test-quick.sqlite-shm/-wal`、`test-integration-audit.sqlite-shm/-wal`、`tsconfig.tsbuildinfo`、`audit.sqlite(+shm/wal)`、`.env.test-scenario`（内容先留档）。不触碰 `data/`（活跃库）与 `.env`（当前配置）。
- R5 验证：`npx tsc --noEmit` 通过；`npm test` 全绿且运行后根目录不新增临时产物；`npm run bench` 新路径可执行。

## Acceptance Criteria

- [x] AC1 根目录不再有 `benchmarks/`；4 个基准位于 `src/__tests__/benchmarks/`，`npm run bench` 通过。（`git mv` 保留 rename；bench 新路径通过）
- [x] AC2 根目录不再有 `integration-test.sh` / `mock-upstream.mjs`；README 两版路径指引与新位置一致；spec 中 benchmarks 引用已同步。
- [x] AC3 `npm test` 全绿（44 passed / 1 skipped files，478 passed / 9 skipped tests；skipped = 8 e2e 因本机 dev server 占锁 + 1 基准因 `真实请求.md` 缺失）；结束后根目录无任何新增 `*.sqlite*` / 临时文件。
- [x] AC4 已确认的删除清单全部移除（14 个文件）；`data/` 与 `.env` 未被修改。
- [x] AC5 `npx tsc --noEmit` 通过（exit 0；顺带修复 `admin-audit.test.ts` 夹具滞后于 `AuditRow` 新增 `mask_*` 字段的 3 个既有 TS 错误）。

## 执行中发现并修复的同类根因（计划外）

- 6 个 route 测试未 mock `@/audit/signals-store`，真实 `insertSignals` 经默认 `DB_PATH`（`audit.sqlite`）在仓库根建库——`vitest.setup.ts` 兜底 `DB_PATH` 至 `tmpdir()/vitest-audit-${pid}.sqlite` 根治（AC3 运行后根目录保持清洁的第二个污染源）。

## Out of Scope

- `src/__tests__/` 内部按层重组（scanner/proxy/admin 再分组）——本次只做收敛与清理。
- `.dockerignore` 对测试资产的排除优化。
- `.env.test-scenario` 的功能合并（当前 `.env` 已覆盖）。
- `public/` 下未引用的 Next.js 模板 svg 清理。
- README 中既有的其他文档漂移（如 `src/app/api/[[...path]]/route.ts` 旧路径描述），另行处理。

## Notes

- 删除项均为 gitignore 覆盖的未跟踪文件（`rm`，非 `git rm`）；唯一不可逆的是根 `audit.sqlite*` 中的本地审计记录，用户已确认放弃。
- 归档任务目录内的历史 `benchmarks/` 引用不回改（历史记录只读）。
