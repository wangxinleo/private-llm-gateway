# Docker & CI/CD 规范

## 环境配置策略

### docker-compose.yaml
Compose 是生产/本地容器启动入口，但不负责构建镜像：镜像由 GitHub/cloud 构建并发布到 GHCR。

硬性契约：
- 使用 `image: ghcr.io/wangxinleo/private-llm-gateway:latest`。
- 禁止本地构建配置；服务器不做镜像构建。
- 禁止环境文件配置和项目专用前缀变量映射。
- 只把必要启动项直接写入 `environment`，用户部署时手动改明文值。
- 禁止添加模拟上游服务或 profile 模拟服务；需要烟测时连接真实上游。

```yaml
services:
  privacy-proxy:
    image: ghcr.io/wangxinleo/private-llm-gateway:latest
    environment:
      NODE_ENV: production
      PORT: 3000
      HOSTNAME: 0.0.0.0
      UPSTREAM_URL: http://host.docker.internal:8787
      DB_PATH: /data/audit.sqlite
      ADMIN_KEY: ""
```

### .env.template
`.env.template` 仅用于直接运行 `npm run dev` / `npm start` 的参考配置，不参与 Compose 启动。不要在模板中维护 Compose 专用变量。

### 应用代码
应用代码只读取应用环境变量（如 `UPSTREAM_URL`, `DB_PATH`, `ADMIN_KEY`, `DEBUG`）。运行期可管理的扫描阈值、路径前缀和排除规则放到后台配置页面/SQLite，不要塞进 Compose。

## 审计原始命中值契约

私有部署需要真实泄露统计：
- `logAudit` 必须把每个 finding 的原始 `matched` 值写入 SQLite `matched_values`。
- 不再提供原始值保留开关；原始命中值默认记录。
- 应用日志和 SSE 审计流不得输出原始命中值。
- 管理后台 reveal-auth 后可获取真实值，但界面显示必须部分掩码并包含 `**`；复制按钮复制真实未掩码值。
- 部署者必须保护 `./data/audit.sqlite` 及 WAL/SHM sidecar 文件。

## Docker Compose 规范

### Volume 策略
- **禁止使用** named volumes。
- **强制使用** bind mount: `./data:/data`。
- 理由: 用户明确要求只使用文件夹映射，便于数据备份和迁移。

### 端口策略
- 默认端口映射固定为 `"3000:3000"`。
- 如需修改端口，直接编辑 Compose，不添加二次变量。

## GitHub Actions CI/CD

### Workflow 结构
1. Checkout 代码
2. 登录 GHCR (使用 GITHUB_TOKEN)
3. Setup QEMU (ARM 模拟)
4. Setup Buildx (多平台构建)
5. Extract metadata (标签生成)
6. Build and push (缓存 + 多平台)
7. Generate attestation (供应链安全)

### 多平台构建
- 支持: `linux/amd64`, `linux/arm64`
- 使用 GitHub Actions cache (type=gha, mode=max)
- 缓存配额: 全仓库 10GB

### 标签策略
- `main`/`master` 分支 → `latest`
- Git tag `v*` → semver 标签（`v1.2.3` → `1.2.3`, `1.2`, `1`）
- 每次提交 → `sha-<git-sha>`

## 验证清单

### 部署前检查
- [ ] `docker compose config` 无错误。
- [ ] `docker-compose.yaml` 不包含本地构建、环境文件、项目专用前缀变量、原始值保留开关或模拟上游服务。
- [ ] `docker compose config | grep "type: bind"` 验证 bind mount。
- [ ] `grep -E "^(ENV|EXPOSE)" Dockerfile` 返回空。
- [ ] `npm test` 覆盖 raw matched value 持久化、reveal-auth 返回、UI 掩码、SSE 不泄漏。
- [ ] `npm run build` 成功。

### CI/CD 检查
- [ ] Workflow YAML 语法正确。
- [ ] GITHUB_TOKEN 权限包含 `packages: write`。
- [ ] 多平台构建测试通过。

## 常见问题

### Q: 如何修改端口？
A: 直接编辑 `docker-compose.yaml` 的 `ports` 和 `PORT` 值，不新增变量映射。

### Q: 如何修改上游地址？
A: 直接编辑 `docker-compose.yaml` 的 `UPSTREAM_URL`。Docker Desktop 访问宿主机可用 `http://host.docker.internal:<port>`；同网络真实服务用服务名。

### Q: 为什么不使用 named volumes？
A: 用户明确要求只使用文件夹映射（bind mounts），便于直接访问和备份数据。

## 相关文件
- `.env.template` - 直接 npm 运行的配置模板
- `docker-compose.yaml` - 镜像启动配置
- `Dockerfile` - 容器构建定义
- `.github/workflows/docker-build.yml` - CI/CD workflow
