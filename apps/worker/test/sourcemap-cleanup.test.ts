import assert from 'node:assert/strict'
import test from 'node:test'
import { SourceMapCleanupHandler } from '../src/sourcemap-cleanup'
import { PrivateSourceMapArtifactStore } from '../../server/app/service/sourcemaps/artifacts'
import { LeasedWorkerJob } from '../../server/app/service/worker'
import { DatabaseClient, QueryResult } from '../../server/app/service/database/types'

const job: LeasedWorkerJob = { id: '10000000-0000-4000-8000-000000000001', tenant_id: '20000000-0000-4000-8000-000000000001', project_id: '30000000-0000-4000-8000-000000000001', kind: 'sourcemap_cleanup', idempotency_key: 'daily:2026-09-12', payload: {}, watermark: {}, lease_owner: 'worker', lease_expires_at: new Date(), attempt_count: 1, max_attempts: 5, processed_count: 0, failed_count: 0 }

test('sourcemap cleanup removes the private object before scoped metadata after error retention', async () => {
  const order: string[] = []
  const database = new CleanupDatabase(order)
  const store = new RecordingArtifacts(order)
  const result = await new SourceMapCleanupHandler(database, store, () => new Date('2026-09-12T00:00:00.000Z')).runJob(job)
  assert.equal(result.processedCount, 1)
  assert.deepEqual(store.removed, [ 'sourcemap/40000000-0000-4000-8000-000000000001.json' ])
  assert.ok(order.indexOf('store.remove') < order.indexOf('metadata.delete'))
  assert.ok(database.calls[0]!.text.includes('NOT EXISTS'))
  assert.ok(database.calls[0]!.text.includes('error_occurrences'))
})

test('sourcemap cleanup fails closed when no private artifact store exists', async () => {
  await assert.rejects(() => new SourceMapCleanupHandler(new CleanupDatabase([])).runJob(job), /sourcemap_artifact_store_unavailable/)
})

class CleanupDatabase implements DatabaseClient {
  readonly calls: Array<{ text: string; values?: readonly unknown[] }> = []
  private readonly order: string[]
  constructor(order: string[]) { this.order = order }
  async query<Row extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
    this.calls.push({ text, values })
    if (text.startsWith('SELECT artifacts.id')) return { rows: [{ id: '40000000-0000-4000-8000-000000000001', artifact_ref: 'sourcemap/40000000-0000-4000-8000-000000000001.json' } as Row], rowCount: 1 }
    if (text.startsWith('DELETE FROM source_map_artifacts')) this.order.push('metadata.delete')
    return { rows: [], rowCount: 1 }
  }
}
class RecordingArtifacts implements PrivateSourceMapArtifactStore {
  readonly removed: string[] = []
  private readonly order: string[]
  constructor(order: string[]) { this.order = order }
  async put(): Promise<{ ref: string; byteCount: number }> { throw new Error('not used') }
  async read(): Promise<Buffer | null> { return null }
  async remove(ref: string): Promise<void> { this.removed.push(ref); this.order.push('store.remove') }
}
