import { tmpdir } from "os";
import { join } from "path";

// vitest 全局前置:为测试统一注入默认上游(模拟"存量部署已配置 UPSTREAM_URL")。
// 路由器在未配置默认上游时对无渠道前缀请求返回 404(防枚举模式)——存量用例
// 均以无前缀路径驱动,这里统一兜底,避免逐文件改动。
process.env.UPSTREAM_URL ||= "http://localhost:8787";

// 测试运行不得在仓库根留下运行期产物:未 mock @/config 的用例(如路由用例经
// insertSignals 落库)统一写到系统临时目录,按 worker pid 隔离,避免落回仓库根。
process.env.DB_PATH ||= join(tmpdir(), `vitest-audit-${process.pid}.sqlite`);
