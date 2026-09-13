#!/usr/bin/env node
/**
 * Creates and verifies an immutable Zhiji backup manifest.  The manifest is
 * intentionally free of connection URLs, credentials and absolute paths.
 */
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

export const BACKUP_MANIFEST_SCHEMA = 'zhiji.backup-manifest.v1'
const SHA256 = /^[a-f0-9]{64}$/
const BACKUP_ID = /^[a-z0-9][a-z0-9._-]{2,119}$/
const SNAPSHOT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value !== 'object') throw new Error('backup_manifest_invalid_value')
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}
export function sha256(content) { return createHash('sha256').update(content).digest('hex') }
export async function fileDigest(path) {
  const content = await readFile(path)
  return { sha256: sha256(content), bytes: content.byteLength }
}

export async function createBackupManifest(input) {
  const createdAt = asIso(input.createdAt, 'created_at')
  assertBackupId(input.backupId)
  if (input.schemaVersion !== BACKUP_MANIFEST_SCHEMA) throw new Error('backup_manifest_schema_version_mismatch')
  const dump = await fileEntry(input.databaseDump, 'database_dump')
  if (input.databaseName !== 'zhiji') throw new Error('backup_manifest_database_must_be_zhiji')
  const pitr = normalizePitr(input.pitr)
  const objects = await Promise.all((input.objectSnapshots ?? []).map(snapshot => snapshotEntry(snapshot)))
  if (!objects.length) throw new Error('backup_manifest_requires_object_snapshot')
  const tombstones = normalizeTombstones(input.tombstoneWatermark)
  const payload = {
    schema_version: BACKUP_MANIFEST_SCHEMA,
    application_schema_version: applicationSchemaVersion(input.applicationSchemaVersion),
    backup_id: input.backupId,
    created_at: createdAt,
    postgres: {
      database: 'zhiji',
      dump: { ...dump, format: 'pg_dump_custom' },
      pitr,
    },
    object_snapshots: objects,
    tombstone_watermark: tombstones,
  }
  const payloadSha256 = sha256(canonicalJson(payload))
  return { ...payload, integrity: { algorithm: 'sha256', payload_sha256: payloadSha256 } }
}

export async function writeImmutableManifest(manifest, outputDirectory) {
  const verified = verifyBackupManifest(manifest)
  const target = resolve(outputDirectory, `backup-manifest-${manifest.backup_id}-${verified.payloadSha256}.json`)
  if (dirname(target) !== resolve(outputDirectory)) throw new Error('backup_manifest_invalid_output_directory')
  const serialized = `${canonicalJson(manifest)}\n`
  try {
    const existing = await readFile(target, 'utf8')
    if (existing !== serialized) throw new Error('backup_manifest_immutable_name_conflict')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') await writeFile(target, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    else if (!(error instanceof Error && error.message === 'backup_manifest_immutable_name_conflict')) throw error
  }
  return target
}

export function verifyBackupManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('backup_manifest_not_object')
  if (manifest.schema_version !== BACKUP_MANIFEST_SCHEMA) throw new Error('backup_manifest_unsupported_schema')
  assertBackupId(manifest.backup_id)
  applicationSchemaVersion(manifest.application_schema_version)
  asIso(manifest.created_at, 'created_at')
  const { integrity, ...payload } = manifest
  if (!integrity || integrity.algorithm !== 'sha256' || !SHA256.test(integrity.payload_sha256 ?? '')) throw new Error('backup_manifest_invalid_integrity')
  const expected = sha256(canonicalJson(payload))
  if (expected !== integrity.payload_sha256) throw new Error('backup_manifest_payload_hash_mismatch')
  if (!payload.postgres || payload.postgres.database !== 'zhiji' || payload.postgres.dump?.format !== 'pg_dump_custom') throw new Error('backup_manifest_invalid_postgres')
  validateFileEntry(payload.postgres.dump, 'database_dump')
  normalizePitr(payload.postgres.pitr)
  if (!Array.isArray(payload.object_snapshots) || !payload.object_snapshots.length) throw new Error('backup_manifest_requires_object_snapshot')
  for (const object of payload.object_snapshots) validateSnapshot(object)
  normalizeTombstones(payload.tombstone_watermark)
  return { payloadSha256: expected }
}

export async function verifyRecoveryInputs(manifestPath, backupDirectory) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const { payloadSha256 } = verifyBackupManifest(manifest)
  const expectedName = `backup-manifest-${manifest.backup_id}-${payloadSha256}.json`
  if (basename(manifestPath) !== expectedName) throw new Error('backup_manifest_filename_hash_mismatch')
  const directory = resolve(backupDirectory)
  const entries = [ manifest.postgres.dump, ...manifest.object_snapshots ]
  for (const entry of entries) {
    const path = resolve(directory, entry.file)
    if (dirname(path) !== directory) throw new Error('backup_manifest_artifact_path_escape')
    const actual = await fileDigest(path)
    if (actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes) throw new Error(`backup_manifest_artifact_hash_mismatch:${entry.file}`)
  }
  return { backupId: manifest.backup_id, schemaVersion: manifest.schema_version, payloadSha256, tombstoneWatermark: manifest.tombstone_watermark, verifiedArtifacts: entries.length }
}

async function fileEntry(path, name) {
  if (typeof path !== 'string' || !path) throw new Error(`backup_manifest_missing_${name}`)
  const metadata = await stat(path)
  if (!metadata.isFile()) throw new Error(`backup_manifest_${name}_not_file`)
  return { file: safeFileName(path, name), ...(await fileDigest(path)) }
}
async function snapshotEntry(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.id !== 'string' || !SNAPSHOT_ID.test(snapshot.id)) throw new Error('backup_manifest_invalid_object_snapshot_id')
  return { id: snapshot.id, ...(await fileEntry(snapshot.archive, 'object_snapshot')) }
}
function validateFileEntry(entry, name) {
  if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(entry.file) || !SHA256.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error(`backup_manifest_invalid_${name}`)
}
function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.id !== 'string' || !SNAPSHOT_ID.test(snapshot.id)) throw new Error('backup_manifest_invalid_object_snapshot_id')
  validateFileEntry(snapshot, 'object_snapshot')
}
function normalizePitr(value) {
  if (!value || typeof value !== 'object' || typeof value.base_backup_id !== 'string' || !SNAPSHOT_ID.test(value.base_backup_id)) throw new Error('backup_manifest_invalid_pitr_base_backup_id')
  return { base_backup_id: value.base_backup_id, recovery_target_time: asIso(value.recovery_target_time, 'pitr_recovery_target_time'), wal_archive_id: value.wal_archive_id === undefined || value.wal_archive_id === null || value.wal_archive_id === '' ? null : validSnapshotId(value.wal_archive_id, 'pitr_wal_archive_id') }
}
function normalizeTombstones(value) {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.count) || value.count < 0) throw new Error('backup_manifest_invalid_tombstone_count')
  const time = value.effective_at
  const id = value.id
  if ((time === null) !== (id === null)) throw new Error('backup_manifest_invalid_tombstone_watermark')
  if (time === null) return { count: value.count, effective_at: null, id: null }
  return { count: value.count, effective_at: asIso(time, 'tombstone_effective_at'), id: validUuid(id, 'tombstone_id') }
}
function safeFileName(path, name) { const file = basename(path); if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(file)) throw new Error(`backup_manifest_invalid_${name}_file_name`); return file }
function applicationSchemaVersion(value) { if (typeof value !== 'string' || !/^\d{3}_[a-z][a-z0-9_]{2,119}$/.test(value)) throw new Error('backup_manifest_invalid_application_schema_version'); return value }
function assertBackupId(value) { if (typeof value !== 'string' || !BACKUP_ID.test(value)) throw new Error('backup_manifest_invalid_backup_id') }
function validSnapshotId(value, name) { if (typeof value !== 'string' || !SNAPSHOT_ID.test(value)) throw new Error(`backup_manifest_invalid_${name}`); return value }
function validUuid(value, name) { if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`backup_manifest_invalid_${name}`); return value.toLowerCase() }
function asIso(value, name) { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(new Date(value).getTime())) throw new Error(`backup_manifest_invalid_${name}`); return new Date(value).toISOString() }

function optionMap(argv) {
  const result = {}; for (let index = 0; index < argv.length; index += 1) { const key = argv[index]; if (!key.startsWith('--')) throw new Error(`backup_manifest_unknown_option:${key}`); const value = argv[++index]; if (!value || value.startsWith('--')) throw new Error(`backup_manifest_missing_option_value:${key}`); result[key.slice(2)] = value } return result
}
async function main(argv) {
  const [ command, ...options ] = argv
  const values = optionMap(options)
  if (command === 'verify') {
    if (!values.manifest || !values['backup-dir']) throw new Error('backup_manifest_verify_requires_manifest_and_backup_dir')
    process.stdout.write(`${JSON.stringify(await verifyRecoveryInputs(values.manifest, values['backup-dir']))}\n`); return
  }
  if (command !== 'create') throw new Error('backup_manifest_command_must_be_create_or_verify')
  const manifest = await createBackupManifest({ backupId: values['backup-id'], createdAt: values['created-at'], schemaVersion: values['schema-version'], applicationSchemaVersion: values['application-schema-version'], databaseName: values.database, databaseDump: values['database-dump'], pitr: { base_backup_id: values['pitr-base-backup-id'], recovery_target_time: values['pitr-recovery-target-time'], wal_archive_id: values['pitr-wal-archive-id'] }, objectSnapshots: [ { id: values['object-snapshot-id'], archive: values['object-snapshot-archive'] } ], tombstoneWatermark: { count: Number(values['tombstone-count']), effective_at: values['tombstone-effective-at'] ?? null, id: values['tombstone-id'] ?? null } })
  if (!values['output-dir']) throw new Error('backup_manifest_create_requires_output_dir')
  process.stdout.write(`${await writeImmutableManifest(manifest, values['output-dir'])}\n`)
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'backup manifest failed'}\n`); process.exitCode = 1 })
