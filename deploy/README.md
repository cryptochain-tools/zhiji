# 知迹原生部署文件

这些文件是可审查的原生安装模板，不会连接服务器、创建账号、写入数据库或启用服务。它们假定一个经过构建的发布目录位于 `/opt/zhiji/current`，且该目录包含 workspace 依赖、`apps/web/dist` 和 `apps/server`。数据库直接部署在目标主机，不依赖 Docker。

## 文件与边界

| 文件 | 用途 |
| --- | --- |
| `systemd/zhiji-web.service` | Egg HTTP 进程，只监听由 `PORT` 指定的 loopback 端口。 |
| `systemd/zhiji-worker.service` | 独立的 PostgreSQL outbox/job worker。 |
| `nginx/zhiji.conf.example` | 单独的 HTTP 回源 `server` block；TLS 由 DCDN 终止。静态控制台由 Nginx 在 `/console` 提供；服务 API 保持 `/api/` 并代理到 Egg；旧地址不做兼容或重定向，`/health/` 不对外暴露。 |
| `env/*.env.example` | 非秘密变量清单；包括私有 S3 artifact store。真实值只能在服务器受限的 `/etc/zhiji/*.env` 中。 |
| `scripts/migrate.sh` | 使用独立迁移账号执行既有 `apps/server` 的 `migrate` 脚本。 |
| `scripts/validate-artifacts.sh` | 只检查模板路径、真实 package script 对齐和示例未含具体数据库凭据。 |

`zhiji-web.service` 的 `ExecStart` 对应 `apps/server/package.json` 中的 `start`：`EGG_TYPESCRIPT=true egg-scripts start --require ts-node/register/transpile-only --workers=1 --title=zhiji-server`。`zhiji-worker.service` 对应 `apps/worker/package.json` 中的 `start`：`tsx src/main.ts`。两个命令均保持前台运行，交由 systemd 监督；不得加 `--daemon`。

Worker 会按 `RETENTION_SCAN_INTERVAL_MS`（默认六小时）扫描仍处于 active 状态的项目，并以项目和 UTC 日期为幂等键，分别入队 `retention_cleanup` 与 `sourcemap_cleanup`。这两个任务由既有 worker 处理；重复扫描或多 worker 实例不会重复执行同一天的清理。

运行本地结构检查：

```sh
deploy/scripts/validate-artifacts.sh
```

## 发布门禁与验证边界

单元测试只在提交来源的本地或 CI 门禁执行，**生产服务器不执行 `pnpm test` 或任何单元测试命令**。生产发布只使用已经通过测试的固定提交和已构建产物，并在目标主机核对提交 SHA、迁移结果、服务状态、loopback 健康检查和外部 HTTPS 路由。

`pnpm build`、迁移和运行态检查仍是生产发布步骤；它们验证当前发布目录、数据库 schema 与实际服务，不替代测试门禁。

## 安装前检查

1. 确认目标域名、证书路径、`127.0.0.1:7011` 未被占用，并构建当前发布目录：`pnpm build`。
2. 由系统管理员创建不同的 `zhiji-web`、`zhiji-worker` Unix 用户和受限环境文件目录；运行数据库账号与迁移数据库账号必须不同，且仅能访问独立的 `zhiji` 数据库。
3. 从 `env/` 复制示例到 `/etc/zhiji/web.env`、`/etc/zhiji/worker.env`、`/etc/zhiji/migrate.env`，填入实际值后设为 root 拥有、服务用户所属组可读，例如权限 `0640`。不要把真实环境文件放回仓库。
4. **S3 artifact configuration：**在 web 和 worker 环境文件中填入同一组完整的 `ZHIJI_ARTIFACT_S3_*` 值。endpoint 必须是 HTTPS；bucket/prefix 必须由知迹独占；访问身份只授予此 prefix 的 `GetObject`、`PutObject`、`DeleteObject`，不授予 public ACL、预签名 URL、`ListBucket` 或跨前缀访问。应用发现任一 S3 必填项时会拒绝不完整配置；启用后优先于所有本地 artifact 目录。先在隔离 bucket/prefix 验证 web 写入、worker 读取/删除和 API 授权读取，确认 Nginx 无 storage location 或裸对象 URL。
5. 本地目录仅是开发 fallback：需要时创建由 `zhiji-web` 与 `zhiji-worker` 共享读写、且不被 Nginx 服务的 `/var/lib/zhiji-shared/{replay-artifacts,sourcemap-artifacts,export-artifacts}`。生产 S3 部署不得把这些目录当作 artifact 的持久副本。
6. 安装 unit 与独立 Nginx 配置前，替换其中的 `<...>` 占位符。先运行 `nginx -t`，再 reload；不要修改同一主机上其他应用的 server block。

## 迁移与启动顺序

在已完成数据库备份和回滚窗口确认后，以受控管理员身份执行：

```sh
sudo install -d -o root -g zhiji-migrate -m 0750 /etc/zhiji
sudo install -m 0640 -o root -g zhiji-migrate deploy/env/migrate.env.example /etc/zhiji/migrate.env
sudo MIGRATION_ENV_FILE=/etc/zhiji/migrate.env deploy/scripts/migrate.sh
```

迁移脚本只接受数据库名为 `zhiji` 的 `DATABASE_URL`，但这只是防误操作的附加检查；执行者仍须确认 URL 实际指向正确环境中的独立数据库。它不会创建数据库、角色或备份。

安装 systemd 文件后，按发布窗口依次执行：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now zhiji-web.service zhiji-worker.service
curl --fail --silent --show-error http://127.0.0.1:7011/health/ready
sudo nginx -t
sudo systemctl reload nginx
```

`/health/live` 仅证明 HTTP 进程存活；`/health/ready` 只有数据库可连接且 migration 达到当前 schema 版本才会返回成功。Nginx 会拒绝外部 `/health/`，监控代理应从 loopback 或受控内部网络检查它。`/health/metrics` 是 aggregate-only 运行指标，也必须维持同样的网络限制；将 worker unit 状态、outbox 积压和最老任务年龄纳入同一告警。确认外部 HTTPS、worker 健康、任务积压、S3 读写路径和同一主机上的既有服务均正常后，才算发布验收完成。

每次发布至少记录以下只读证据；任一项失败都不应把发布标为就绪：

```sh
curl --fail --silent --show-error http://127.0.0.1:7011/health/live
curl --fail --silent --show-error http://127.0.0.1:7011/health/ready
curl --fail --silent --show-error http://127.0.0.1:7011/health/metrics
systemctl --no-pager --full status zhiji-web.service zhiji-worker.service
```

## 回滚

停止知迹流量时先从知迹独立 Nginx block 移除或停用域名，再停止两个知迹 unit：

```sh
sudo systemctl disable --now zhiji-worker.service zhiji-web.service
```

不要通过删除 PostgreSQL schema、对象或环境文件来回滚，也不要改动同一主机上其他应用的配置。数据库回滚、对象恢复和 migration 降级必须有单独、经过演练的方案。

## 本地备份、恢复边界与审计 manifest

`backup-local.sh` 只为独立的 `zhiji` 数据库创建本地恢复集。它需要显式
`--confirm-create-backup`，从受限环境文件读取专用备份账号，生成 PostgreSQL
custom-format dump、私有 artifact 目录的 tar snapshot，以及不可变命名的
`backup-manifest-<backup-id>-<payload-sha256>.json`。manifest 采用
`zhiji.backup-manifest.v1`，记录应用 schema 版本、PITR 的 base backup / WAL archive
标识与 recovery target time、对象 snapshot 标识、删除 tombstone watermark、每个文件的
字节数和 SHA-256。manifest 不记录数据库 URL、绝对路径或秘密。

生产 S3 不允许此脚本列举或下载 bucket。每次备份先由对象存储提供方以独立备份身份创建
不可变 snapshot/export，固定版本、时间和 bucket/prefix 范围；再把该 export 下载到
**隔离备份主机**的临时目录，作为 `--object-artifact-dir` 输入。`--object-snapshot-id`
必须是可审计的提供方 snapshot/export 标识。不得以 web/worker 的 S3 写入凭据执行备份，
也不得把 endpoint、bucket、对象键或客户内容写进 manifest。

```sh
sudo install -m 0640 -o root -g zhiji-backup deploy/env/backup.env.example /etc/zhiji/backup.env
sudo deploy/scripts/backup-local.sh \
  --confirm-create-backup \
  --env-file /etc/zhiji/backup.env \
  --backup-dir /var/backups/zhiji/20260912 \
  --object-artifact-dir /srv/zhiji-backup-staging/objects-20260912 \
  --object-snapshot-id <provider-immutable-snapshot-id> \
  --pitr-base-backup-id pg-base-20260912 \
  --pitr-wal-archive-id wal-20260912 \
  --pitr-recovery-target-time 2026-09-12T12:00:00.000Z
```

PITR 的 base backup、WAL archive 和 target time 是操作员提供且由 manifest 固化的
恢复边界；本地脚本不会假装 WAL 可用或执行恢复。任何恢复只允许在隔离环境进行。恢复
前必须验证本地文件、manifest 命名和所有 SHA-256：

```sh
node deploy/scripts/backup-manifest.mjs verify \
  --manifest /var/backups/zhiji/20260912/backup-manifest-<backup-id>-<payload-sha256>.json \
  --backup-dir /var/backups/zhiji/20260912
```

验证成功后，在与生产数据库、对象 bucket 和 Nginx 网络隔离的 restore 环境执行：

1. 用新建的、非生产名称的空数据库执行 `pg_restore --no-owner --no-privileges`；不要覆盖生产数据库或其他应用的数据库。
2. 恢复同一 manifest 指定的对象 snapshot 到隔离 bucket/prefix；禁止恢复到生产 bucket/prefix。
3. 让隔离 web 使用恢复数据库和隔离对象 prefix，确认 manifest 的 `application_schema_version`、`/health/ready`、抽样只读查询和受权 artifact 读取均成功。
4. 先运行 `pnpm --dir apps/worker replay-tombstones -- --dry-run`，确认输出范围不超过 manifest 的 `tombstone_watermark`。经记录的操作员确认后才可带 `--confirm-restore-tombstones` 重放删除墓碑。

这就是 **isolated restore environment** 的最低验证范围；不得将恢复数据库或对象直接暴露给业务流量。演练结束后按隔离环境的保留规则清理临时恢复集，并记录 manifest 哈希、恢复目标、验证结果与清理时间。
