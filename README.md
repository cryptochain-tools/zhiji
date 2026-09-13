# 知迹 Zhiji

知迹是一套可自托管的多租户产品分析与错误监控平台。它把产品事件、错误、Web 性能、热力图和经过脱敏的会话回放放在同一个项目工作台中，并用独立采集通道控制限流、重试和数据保留。

> 项目源码已经公开。Browser SDK 已发布为 `@zhiji-labs/browser-sdk@0.1.1`；Node、Python 与 Mobile SDK 仍处于计划或预览阶段。

## 已实现能力

- 多租户、成员角色和项目级授权
- 产品事件、趋势、漏斗、留存、路径与分群
- 浏览器错误归组、Source Map、Web Vitals 与告警
- 热力图和隐私受限的会话回放
- 保存洞察、仪表盘、聚合导出和报表计划
- 匿名 visitor 与已验证业务用户的多归属关联
- Server Key 管理的业务用户资料目录，联系人字段与事件属性隔离
- PostgreSQL 队列、数据生命周期、审计日志和私有 S3 兼容工件存储

## 技术要求

- Node.js 22 LTS
- pnpm 10.33 或兼容的 pnpm 10 版本
- PostgreSQL 15 或更高版本
- 生产环境需要 HTTPS 反向代理
- 回放、Source Map 和导出功能需要私有 S3 兼容对象存储；本地目录只适合开发

## 本地启动

```bash
corepack enable
pnpm install --frozen-lockfile

createdb zhiji
export DATABASE_URL='postgresql://localhost/zhiji'
pnpm --dir apps/server migrate
```

分别启动 API、Worker 和 Web：

```bash
APP_ORIGIN='http://localhost:5173' \
DATABASE_URL='postgresql://localhost/zhiji' \
pnpm --dir apps/server dev
```

```bash
DATABASE_URL='postgresql://localhost/zhiji' \
pnpm --dir apps/worker start
```

```bash
VITE_ZHIJI_API_BASE_URL='http://127.0.0.1:7001' \
pnpm --dir apps/web dev
```

访问 `http://localhost:5173`。首次部署可以通过受控配置开启注册，生产环境建议关闭公开注册并由租户所有者邀请成员。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm audit --prod
deploy/scripts/validate-artifacts.sh
```

## 生产部署

[部署说明](deploy/README.md)包含环境变量、数据库迁移、systemd、Nginx、备份和恢复边界。生产发布至少需要：

1. 使用独立 PostgreSQL 数据库和运行账号。
2. 将真实秘密保存在仓库外的受限环境文件中。
3. 在切换版本前执行测试、生产构建、数据库备份和迁移。
4. 启动 Web 与 Worker 后检查 `/health/live`、`/health/ready` 和内部 `/health/metrics`。
5. 从公网验证 HTTPS、静态资源和管理台，再记录固定提交 SHA。

升级时始终使用固定 Release 或提交，不要直接运行未知分支；先备份，再执行 `pnpm --dir apps/server migrate`，最后滚动重启 Web 和 Worker。

## SDK 与采集

浏览器项目可以从已发布 SDK 开始：

```bash
pnpm add @zhiji-labs/browser-sdk
```

```ts
import { init } from '@zhiji-labs/browser-sdk'

const zhiji = init({
  key: 'zj_pk_your_project_key',
  release: '2026.09.13',
})

zhiji.track('pricing_viewed', { plan: 'pro' })
```

Browser Key 可以出现在前端，但必须配置精确 Origin。服务端、移动端和 Source Map 上传必须使用各自类型的 Key，不能复用 Browser Key。详细协议和身份关联说明见 Web 文档中心。

## 成熟度

| 模块 | 状态 |
| --- | --- |
| Web 控制台与服务端 | 可自托管，持续完善 |
| Browser SDK | 已发布 `0.1.1` |
| Vite Source Map 插件 | 预览，尚未公开发布 |
| Node SDK | 计划中 |
| Python SDK | 预览，尚未发布到 PyPI |
| Mobile SDK | 计划中 |

## 安全与隐私

请阅读 [SECURITY.md](SECURITY.md) 后再报告漏洞。不要在公开 Issue 中提交 Cookie、API Key、Source Map、回放内容、数据库连接串或用户数据。采集默认遵循最小化原则，行为与回放能力需要项目策略和客户端配置同时开启。

## 参与贡献

提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。变更记录位于 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

平台服务端、Worker、Web 和仓库中未另行声明的代码使用 [GNU Affero General Public License v3.0](LICENSE)。Browser、Node、Python、Mobile SDK 与 Vite 插件目录各自使用 MIT License。第三方与迁移来源说明见 [NOTICE](NOTICE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

软件许可证本身不收费；运行 PostgreSQL、对象存储、域名、HTTPS、邮件与通知通道仍会产生基础设施和维护成本。
