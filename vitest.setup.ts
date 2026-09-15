// vitest 全局前置:为测试统一注入默认上游(模拟"存量部署已配置 UPSTREAM_URL")。
// 路由器在未配置默认上游时对无渠道前缀请求返回 404(防枚举模式)——存量用例
// 均以无前缀路径驱动,这里统一兜底,避免逐文件改动。
process.env.UPSTREAM_URL ||= "http://localhost:8787";
