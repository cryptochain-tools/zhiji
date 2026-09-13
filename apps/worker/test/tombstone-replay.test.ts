import assert from 'node:assert/strict'
import test from 'node:test'
import { TombstoneReplayMaintenance, runTombstoneReplayFromEnvironment } from '../src/tombstone-replay'
import { PostgreSqlConnection } from '../../server/app/service/database/types'

const tenantId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const tombstoneId = '33333333-3333-4333-8333-333333333333'

class RecordingDatabase {
  readonly statements: string[] = []
  readonly values: readonly unknown[][] = []
  private listed = false
  constructor(private readonly projectDeletion = false) {}
  private row() { return { id: tombstoneId, tenant_id: tenantId, project_id: projectId, subject_business_user_id: this.projectDeletion ? null : 'account-42', project_deletion: this.projectDeletion, effective_at: new Date('2026-09-12T00:00:00.000Z') } }
  private readonly connection: PostgreSqlConnection = {
    query: async <Row extends object>(text: string, values?: readonly unknown[]) => {
      this.statements.push(text); this.values.push(values ?? [])
      if (text.includes('FROM deletion_tombstones') && text.includes('ORDER BY effective_at')) {
        if (this.listed) return { rows: [] as Row[], rowCount: 0 }
        this.listed = true
        return { rows: [ this.row() ] as Row[], rowCount: 1 }
      }
      if (text.includes('FROM deletion_tombstones WHERE id = $1 FOR UPDATE')) return { rows: [ this.row() ] as Row[], rowCount: 1 }
      if (text.startsWith('SELECT id, artifact_ref FROM replay_chunks')) return { rows: [] as Row[], rowCount: 0 }
      return { rows: [] as Row[], rowCount: 0 }
    }, release: () => undefined,
  }
  async connect() { return this.connection }
  query<Row extends object>(text: string, values?: readonly unknown[]) { return this.connection.query<Row>(text, values) }
}

test('dry run scans tombstones without a transaction or mutation', async () => {
  const database = new RecordingDatabase()
  const result = await new TombstoneReplayMaintenance(database).replay({ dryRun: true, batchSize: 10 })
  assert.deepEqual(result, { scanned: 1, replayed: 0, dryRun: true, subjectTombstones: 1, projectTombstones: 0, recordsRemoved: 0, batches: 1, nextCursor: { effectiveAt: '2026-09-12T00:00:00.000Z', id: tombstoneId } })
  assert.equal(database.statements.includes('BEGIN'), false)
  assert.equal(database.statements.some(statement => statement.includes('DELETE FROM')), false)
})

test('subject tombstone replay is transactional, batched, and leaves an operator audit metric', async () => {
  const database = new RecordingDatabase()
  const result = await new TombstoneReplayMaintenance(database).replay({ batchSize: 1, operatorLabel: 'restore-20260912' })
  assert.equal(result.replayed, 1)
  assert.ok(database.statements.includes('BEGIN') && database.statements.includes('COMMIT'))
  assert.ok(database.statements.some(statement => statement.includes('UPDATE events SET business_user_id = NULL')))
  assert.ok(database.statements.some(statement => statement.includes('DELETE FROM identities')))
  assert.equal(database.statements.some(statement => statement.includes('DELETE FROM replay_sessions')), false)
  assert.ok(database.statements.some(statement => statement.includes('deletion_tombstone_replayed_after_restore')))
  assert.ok(database.values.some(values => values.some(value => typeof value === 'string' && value.includes('restore-20260912'))))
})

test('project tombstone freezes the project and cancels pending work before deleting project facts', async () => {
  const database = new RecordingDatabase(true)
  await new TombstoneReplayMaintenance(database).replay({ batchSize: 1 })
  const frozen = database.statements.findIndex(statement => statement.includes("deletion_status = 'deleted'"))
  const cancelled = database.statements.findIndex(statement => statement.includes("status = 'cancelled'"))
  const deleted = database.statements.findIndex(statement => statement.includes('DELETE FROM dashboard_tiles'))
  assert.ok(frozen >= 0 && frozen < cancelled && cancelled < deleted)
  assert.ok(database.statements.some(statement => statement.includes('DELETE FROM analytics_export_download_tokens')))
  assert.ok(database.statements.some(statement => statement.includes('deletion_tombstone_replayed_after_restore')))
})

test('invalid options and missing explicit execution confirmation fail before database access', async () => {
  const database = new RecordingDatabase()
  await assert.rejects(() => new TombstoneReplayMaintenance(database).replay({ batchSize: 0 }), /invalid_tombstone_replay_batchSize/)
  await assert.rejects(() => runTombstoneReplayFromEnvironment({}, []), /refusing_tombstone_replay_without_confirm_restore_tombstones/)
  await assert.rejects(() => new TombstoneReplayMaintenance(database).replay({ after: { effectiveAt: 'invalid', id: tombstoneId } }), /invalid_tombstone_replay_after_cursor/)
})
