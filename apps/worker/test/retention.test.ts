import assert from 'node:assert/strict'
import test from 'node:test'
import { RetentionCleanupHandler } from '../src/retention'
import { LeasedWorkerJob } from '../../server/app/service/worker'
import { PostgreSqlConnection } from '../../server/app/service/database/types'
import { PrivateReplayArtifactStore } from '../../server/app/service/replay/artifacts'

const tenantId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'

class RecordingDatabase {
  readonly statements: string[] = []
  readonly values: readonly unknown[][] = []
  private readonly connection: PostgreSqlConnection = {
    query: async <Row extends object>(text: string, values?: readonly unknown[]) => {
      this.statements.push(text)
      this.values.push(values ?? [])
      if (text.includes('FROM projects JOIN tenants')) return { rows: this.active ? [ { retention_days: 365 } as Row ] : [], rowCount: this.active ? 1 : 0 }
      return { rows: [] as Row[], rowCount: 1 }
    },
    release: () => undefined,
  }
  constructor(private readonly active = true) {}
  async connect(): Promise<PostgreSqlConnection> { return this.connection }
}

function job(): LeasedWorkerJob {
  return { id: '33333333-3333-4333-8333-333333333333', tenant_id: tenantId, project_id: projectId, kind: 'retention_cleanup', idempotency_key: 'daily:2026-09-12', payload: {}, watermark: {}, lease_owner: 'test', lease_expires_at: new Date(), attempt_count: 1, max_attempts: 10, processed_count: 0, failed_count: 0 }
}

test('retention cleanup uses effective policy, hard module caps, and bounded raw and aggregate deletes', async () => {
  const database = new RecordingDatabase()
  const result = await new RetentionCleanupHandler(database, () => new Date('2026-09-12T00:00:00.000Z')).runJob(job())
  assert.equal(result.processedCount, 12)
  assert.equal(result.failedCount, 0)
  assert.ok(database.statements.some(text => text.includes('FROM events') && text.includes('ORDER BY occurred_at ASC, id ASC') && text.includes('LIMIT $4')))
  assert.ok(database.statements.some(text => text.includes('FROM error_occurrences')))
  assert.ok(database.statements.some(text => text.includes('FROM behavior_events')))
  assert.ok(database.statements.some(text => text.includes('FROM performance_observations')))
  assert.ok(database.statements.some(text => text.includes('FROM heatmap_bins_daily') && text.includes('occurred_on <')))
  assert.ok(database.statements.some(text => text.includes('FROM heatmap_series_daily') && text.includes('occurred_on <')))
  assert.ok(database.statements.some(text => text.includes('FROM performance_metric_daily') && text.includes('day <')))
  assert.ok(database.statements.some(text => text.includes('FROM usage_ledger_daily') && text.includes('usage_date <')))
  assert.equal(database.statements.some(text => text.startsWith('DELETE FROM replay_chunks')), false)
  assert.ok(database.statements.some(text => text.includes('FROM ingest_receipts') && text.includes('ORDER BY received_at ASC, lane ASC, client_event_id ASC')))
  assert.ok(database.statements.some(text => text.includes('FROM replay_sessions') && text.includes('NOT EXISTS')))
  assert.ok(database.statements.some(text => text.includes('FROM cohort_snapshots') && text.includes('expires_at <= now()')))
  assert.equal(database.statements.some(text => /DELETE FROM (error_groups|audit_logs|source_map_artifacts|heatmap_screenshots)/.test(text)), false)
  const eventValues = database.values.find(values => values[2] instanceof Date && (values[2] as Date).toISOString() === '2025-09-12T00:00:00.000Z')
  assert.ok(eventValues)
  assert.equal((result.watermark?.preserved_metadata as readonly string[]).includes('audit_logs'), true)
})

test('inactive projects are skipped before any data delete', async () => {
  const database = new RecordingDatabase(false)
  const result = await new RetentionCleanupHandler(database).runJob(job())
  assert.deepEqual(result.watermark?.skipped, 'project_not_active')
  assert.equal(database.statements.some(text => text.includes('DELETE FROM')), false)
  assert.ok(database.statements.includes('COMMIT'))
})

test('expired replay objects are removed before their metadata', async () => {
  const database = new ReplayCandidateDatabase()
  const store = new RecordingReplayStore(database.order)
  await new RetentionCleanupHandler(database, () => new Date('2026-09-12T00:00:00.000Z'), store).runJob(job())
  assert.deepEqual(store.removed, [ 'replay/33333333-3333-4333-8333-333333333333.json' ])
  const objectDelete = database.order.findIndex(value => value === 'store.remove')
  const metadataDelete = database.order.findIndex(text => text === 'metadata.delete')
  assert.ok(objectDelete >= 0 && metadataDelete >= 0)
})

class ReplayCandidateDatabase extends RecordingDatabase {
  readonly order: string[] = []
  private readonly replayConnection: PostgreSqlConnection = {
    query: async <Row extends object>(text: string, values?: readonly unknown[]) => {
      this.statements.push(text); this.values.push(values ?? [])
      if (text.includes('FROM projects JOIN tenants')) return { rows: [ { retention_days: 365 } as Row ], rowCount: 1 }
      if (text.startsWith('SELECT id, artifact_ref FROM replay_chunks')) return { rows: [ { id: '33333333-3333-4333-8333-333333333333', artifact_ref: 'replay/33333333-3333-4333-8333-333333333333.json' } as Row ], rowCount: 1 }
      if (text.startsWith('DELETE FROM replay_chunks WHERE id')) this.order.push('metadata.delete')
      return { rows: [] as Row[], rowCount: 1 }
    }, release: () => undefined,
  }
  async connect(): Promise<PostgreSqlConnection> { return this.replayConnection }
}

class RecordingReplayStore implements PrivateReplayArtifactStore {
  readonly removed: string[] = []
  constructor(private readonly order: string[]) {}
  async put(): Promise<{ ref: string; byteCount: number }> { throw new Error('not used') }
  async read(): Promise<Buffer | null> { return null }
  async remove(ref: string): Promise<void> { this.removed.push(ref); this.order.push('store.remove') }
}
