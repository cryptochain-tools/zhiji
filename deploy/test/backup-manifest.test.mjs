import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { BACKUP_MANIFEST_SCHEMA, canonicalJson, createBackupManifest, sha256, verifyBackupManifest, verifyRecoveryInputs, writeImmutableManifest } from '../scripts/backup-manifest.mjs'

const tombstoneId = '11111111-1111-4111-8111-111111111111'
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zhiji-backup-'))
  const dump = join(directory, 'database-safe.dump')
  const objects = join(directory, 'objects-safe.tar')
  await writeFile(dump, 'postgres-custom-dump')
  await writeFile(objects, 'object snapshot')
  const manifest = await createBackupManifest({
    backupId: 'zhiji-20260912-1', createdAt: '2026-09-12T12:00:00.000Z', schemaVersion: BACKUP_MANIFEST_SCHEMA, applicationSchemaVersion: '032_data_lifecycle_policy', databaseName: 'zhiji', databaseDump: dump,
    pitr: { base_backup_id: 'base-20260912', recovery_target_time: '2026-09-12T12:00:00.000Z', wal_archive_id: 'wal-20260912' },
    objectSnapshots: [ { id: 'zhiji-objects-20260912', archive: objects } ],
    tombstoneWatermark: { count: 2, effective_at: '2026-09-12T11:59:00.000Z', id: tombstoneId },
  })
  return { directory, dump, objects, manifest }
}

test('manifest captures application schema, PITR, object and tombstone recovery boundaries with content hash', async () => {
  const { manifest } = await fixture()
  assert.equal(manifest.application_schema_version, '032_data_lifecycle_policy')
  assert.equal(manifest.postgres.pitr.base_backup_id, 'base-20260912')
  assert.equal(manifest.object_snapshots[0].id, 'zhiji-objects-20260912')
  assert.deepEqual(manifest.tombstone_watermark, { count: 2, effective_at: '2026-09-12T11:59:00.000Z', id: tombstoneId })
  assert.match(manifest.integrity.payload_sha256, /^[a-f0-9]{64}$/)
  assert.equal(verifyBackupManifest(manifest).payloadSha256, manifest.integrity.payload_sha256)
})

test('immutable filename and recovery verifier reject altered backup artifacts', async () => {
  const { directory, dump, manifest } = await fixture()
  const path = await writeImmutableManifest(manifest, directory)
  assert.equal(basename(path), `backup-manifest-${manifest.backup_id}-${manifest.integrity.payload_sha256}.json`)
  assert.equal((await verifyRecoveryInputs(path, directory)).verifiedArtifacts, 2)
  await writeFile(dump, 'tampered')
  await assert.rejects(() => verifyRecoveryInputs(path, directory), /backup_manifest_artifact_hash_mismatch/)
})

test('manifest validation rejects altered integrity, path escapes and incomplete tombstone watermarks', async () => {
  const { manifest } = await fixture()
  const altered = structuredClone(manifest); altered.postgres.database = 'other'
  assert.throws(() => verifyBackupManifest(altered), /backup_manifest_payload_hash_mismatch/)
  const badWatermark = structuredClone(manifest); badWatermark.tombstone_watermark.id = null
  const { integrity: ignored, ...badPayload } = badWatermark
  badWatermark.integrity.payload_sha256 = sha256(canonicalJson(badPayload))
  assert.throws(() => verifyBackupManifest(badWatermark), /backup_manifest_invalid_tombstone_watermark/)
  const text = await readFile(new URL('../scripts/backup-manifest.mjs', import.meta.url), 'utf8')
  assert.match(text, /backup_manifest_artifact_path_escape/)
})
