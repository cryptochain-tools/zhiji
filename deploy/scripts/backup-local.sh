#!/usr/bin/env sh
# Create a local, immutable recovery set for an isolated zhiji database.
# It never restores, uploads, deletes, or contacts a remote host.
set -eu
umask 077

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
deploy_root=$(CDPATH='' cd -- "$script_dir/../.." && pwd)

usage() {
  cat >&2 <<'USAGE'
usage: backup-local.sh --confirm-create-backup --env-file FILE --backup-dir DIR \
  --object-artifact-dir DIR --object-snapshot-id ID --pitr-base-backup-id ID \
  --pitr-recovery-target-time ISO_8601_UTC [--pitr-wal-archive-id ID] [--backup-id ID]

The env file is trusted, root-managed KEY=VALUE input and must provide DATABASE_URL.
This command creates a pg_dump custom archive, an artifact tar snapshot, and an
immutable manifest. It does not prove WAL availability or perform a restore.
USAGE
  exit 64
}
confirm=false
env_file=
backup_dir=
object_dir=
object_snapshot_id=
pitr_base_backup_id=
pitr_recovery_target_time=
pitr_wal_archive_id=
backup_id=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --confirm-create-backup) confirm=true; shift ;;
    --env-file|--backup-dir|--object-artifact-dir|--object-snapshot-id|--pitr-base-backup-id|--pitr-recovery-target-time|--pitr-wal-archive-id|--backup-id)
      [ "$#" -ge 2 ] || usage
      case "$1" in
        --env-file) env_file=$2 ;;
        --backup-dir) backup_dir=$2 ;;
        --object-artifact-dir) object_dir=$2 ;;
        --object-snapshot-id) object_snapshot_id=$2 ;;
        --pitr-base-backup-id) pitr_base_backup_id=$2 ;;
        --pitr-recovery-target-time) pitr_recovery_target_time=$2 ;;
        --pitr-wal-archive-id) pitr_wal_archive_id=$2 ;;
        --backup-id) backup_id=$2 ;;
      esac
      shift 2 ;;
    *) usage ;;
  esac
done
[ "$confirm" = true ] || { echo 'refusing backup without --confirm-create-backup' >&2; exit 64; }
[ -n "$env_file" ] && [ -n "$backup_dir" ] && [ -n "$object_dir" ] && [ -n "$object_snapshot_id" ] && [ -n "$pitr_base_backup_id" ] && [ -n "$pitr_recovery_target_time" ] || usage
[ -r "$env_file" ] || { echo "backup environment file is not readable: $env_file" >&2; exit 64; }
[ -d "$object_dir" ] || { echo "object artifact directory is not a directory: $object_dir" >&2; exit 66; }
[ -d "$backup_dir" ] || { echo "backup directory must already exist: $backup_dir" >&2; exit 66; }

set -a
. "$env_file"
set +a
[ -n "${DATABASE_URL:-}" ] || { echo 'DATABASE_URL is required in backup environment file' >&2; exit 64; }
case "$DATABASE_URL" in
  */zhiji|*/zhiji\?*) ;;
  *) echo 'refusing a DATABASE_URL whose database name is not zhiji' >&2; exit 64 ;;
esac
command -v pg_dump >/dev/null || { echo 'pg_dump is required' >&2; exit 69; }
command -v psql >/dev/null || { echo 'psql is required' >&2; exit 69; }
command -v tar >/dev/null || { echo 'tar is required' >&2; exit 69; }
command -v node >/dev/null || { echo 'node is required' >&2; exit 69; }

created_at=$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')
if [ -z "$backup_id" ]; then backup_id="zhiji-$(date -u '+%Y%m%dT%H%M%SZ')-$$"; fi
case "$backup_id" in *[!a-z0-9._-]*|'') echo 'invalid backup id' >&2; exit 64;; esac

# Keep database and object artifacts colocated with the manifest. The names are
# deterministic from backup_id; pre-existing files fail rather than overwrite.
dump_file="$backup_dir/database-$backup_id.dump"
object_file="$backup_dir/objects-$backup_id.tar"
[ ! -e "$dump_file" ] && [ ! -e "$object_file" ] || { echo 'backup artifact already exists; choose a new backup id' >&2; exit 73; }

# DATABASE_URL is read from the protected environment file; this command never
# prints it. Use a dedicated backup role with read-only database permissions.
pg_dump --format=custom --no-owner --no-privileges --file "$dump_file" "$DATABASE_URL"
tar -C "$object_dir" -cf "$object_file" .

watermark=$(psql --no-psqlrc --tuples-only --no-align --field-separator '|' "$DATABASE_URL" -c "SELECT count(*)::text, COALESCE((SELECT to_char(effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') FROM deletion_tombstones ORDER BY effective_at DESC, id DESC LIMIT 1), ''), COALESCE((SELECT id::text FROM deletion_tombstones ORDER BY effective_at DESC, id DESC LIMIT 1), '') FROM deletion_tombstones")
tombstone_count=${watermark%%|*}
remainder=${watermark#*|}
tombstone_effective_at=${remainder%%|*}
tombstone_id=${remainder#*|}
[ -n "$tombstone_count" ] || { echo 'could not read deletion tombstone watermark' >&2; exit 70; }

schema_version=$(sed -n "s/^export const CURRENT_SCHEMA_VERSION = '\([^']*\)'/\1/p" "$deploy_root/apps/server/app/service/database/runtime.ts")
[ -n "$schema_version" ] || { echo 'could not determine current schema version' >&2; exit 70; }

set -- create --output-dir "$backup_dir" --backup-id "$backup_id" --created-at "$created_at" --schema-version zhiji.backup-manifest.v1 --application-schema-version "$schema_version" --database zhiji --database-dump "$dump_file" --pitr-base-backup-id "$pitr_base_backup_id" --pitr-recovery-target-time "$pitr_recovery_target_time" --object-snapshot-id "$object_snapshot_id" --object-snapshot-archive "$object_file" --tombstone-count "$tombstone_count"
[ -n "$pitr_wal_archive_id" ] && set -- "$@" --pitr-wal-archive-id "$pitr_wal_archive_id"
[ -n "$tombstone_effective_at" ] && set -- "$@" --tombstone-effective-at "$tombstone_effective_at" --tombstone-id "$tombstone_id"
manifest=$(node "$script_dir/backup-manifest.mjs" "$@")
printf '%s\n' "$manifest"
printf '%s\n' "schema_version=$schema_version" >&2
printf '%s\n' 'backup created; before any restore run backup-manifest.mjs verify against this directory and replay tombstones in an isolated database.' >&2
