#!/usr/bin/env sh
# Local structural check only: it does not inspect, connect to, or change a host.
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)

for file in \
  deploy/systemd/zhiji-web.service \
  deploy/systemd/zhiji-worker.service \
  deploy/nginx/zhiji.conf.example \
  deploy/env/web.env.example \
  deploy/env/worker.env.example \
  deploy/env/migrate.env.example \
  deploy/env/backup.env.example \
  deploy/scripts/migrate.sh \
  deploy/scripts/backup-local.sh \
  deploy/scripts/backup-manifest.mjs; do
  test -f "$root/$file" || { echo "missing: $file" >&2; exit 1; }
done

# Keep unit entrypoints aligned with actual workspace package scripts.
grep -Fq '"start": "EGG_TYPESCRIPT=true egg-scripts start --require ts-node/register/transpile-only --workers=1 --title=zhiji-server"' "$root/apps/server/package.json"
grep -Fq 'ExecStart=/usr/local/bin/pnpm --dir /opt/zhiji/current/apps/server start' "$root/deploy/systemd/zhiji-web.service"
grep -Fq '"start": "tsx src/main.ts"' "$root/apps/worker/package.json"
grep -Fq 'ExecStart=/usr/local/bin/pnpm --dir /opt/zhiji/current/apps/worker start' "$root/deploy/systemd/zhiji-worker.service"
grep -Fq 'CURRENT_SCHEMA_VERSION' "$root/apps/server/app/service/database/runtime.ts"
grep -Fq '"migrate": "tsx scripts/migrate.ts"' "$root/apps/server/package.json"
test ! -e "$root/apps/server/app/service/database/migrate.ts"
grep -Fq 'exec "$pnpm_bin" --dir "$deploy_root/apps/server" migrate' "$root/deploy/scripts/migrate.sh"
grep -Fq 'backup_manifest_schema_version_mismatch' "$root/deploy/scripts/backup-manifest.mjs"
grep -Fq -- '--confirm-create-backup' "$root/deploy/scripts/backup-local.sh"
grep -Fq 'deletion_tombstones' "$root/deploy/scripts/backup-local.sh"
for environment in web worker; do
  for key in \
    ZHIJI_ARTIFACT_S3_ENDPOINT \
    ZHIJI_ARTIFACT_S3_BUCKET \
    ZHIJI_ARTIFACT_S3_PREFIX \
    ZHIJI_ARTIFACT_S3_REGION \
    ZHIJI_ARTIFACT_S3_ACCESS_KEY_ID \
    ZHIJI_ARTIFACT_S3_SECRET_ACCESS_KEY \
    ZHIJI_ARTIFACT_S3_SERVER_SIDE_ENCRYPTION; do
    grep -Fq "$key" "$root/deploy/env/$environment.env.example"
  done
done
grep -Fq 'provider-native, immutable snapshot/export' "$root/deploy/env/backup.env.example"
grep -Fq 'S3 artifact configuration' "$root/deploy/README.md"
grep -Fq 'isolated restore environment' "$root/deploy/README.md"
grep -Fq 'location ^~ /api/' "$root/deploy/nginx/zhiji.conf.example"
grep -Fq 'location = /console' "$root/deploy/nginx/zhiji.conf.example"
grep -Fq 'location ^~ /console/' "$root/deploy/nginx/zhiji.conf.example"
grep -Fq '静态控制台由 Nginx 在 `/console` 提供' "$root/deploy/README.md"
grep -Fq 'Disallow: /console' "$root/apps/web/public-robots.txt"

# Do not allow plausible real credentials into versioned templates.
if grep -REn --include='*.example' 'postgresql://[^<[:space:]]+:[^<[:space:]]+@' "$root/deploy/env"; then
  echo 'environment template appears to contain a concrete database credential' >&2
  exit 1
fi

printf '%s\n' 'deployment artifact structural checks passed'
