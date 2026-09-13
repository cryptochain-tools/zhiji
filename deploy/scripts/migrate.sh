#!/usr/bin/env sh
# Runs the existing apps/server migration entrypoint with an isolated migration
# environment. It never creates databases or users.
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
deploy_root=$(CDPATH='' cd -- "$script_dir/../.." && pwd)
env_file=${MIGRATION_ENV_FILE:-/etc/zhiji/migrate.env}
pnpm_bin=${PNPM_BIN:-/usr/local/bin/pnpm}

if [ ! -r "$env_file" ]; then
  echo "migration environment file is not readable: $env_file" >&2
  exit 64
fi

# EnvironmentFile syntax is intentionally limited to trusted root-managed
# KEY=VALUE lines. Do not pass an arbitrary user-controlled path here.
set -a
. "$env_file"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo 'DATABASE_URL is required in the migration environment file' >&2
  exit 64
fi
case "$DATABASE_URL" in
  */zhiji|*/zhiji\?*) ;;
  *)
    echo 'refusing a DATABASE_URL whose database name is not zhiji' >&2
    exit 64
    ;;
esac

if [ ! -f "$deploy_root/apps/server/package.json" ]; then
  echo "expected apps/server package under $deploy_root" >&2
  exit 66
fi

if [ ! -x "$pnpm_bin" ]; then
  echo "pnpm executable is unavailable: $pnpm_bin" >&2
  exit 69
fi

exec "$pnpm_bin" --dir "$deploy_root/apps/server" migrate
