import assert from 'node:assert/strict'
import { DatabasePool, DatabaseTransaction, QueryResult } from '../../../../app/service/database/types'
import { PostgreSqlIngestWriter } from '../../../../app/service/ingest/writer'
import { validateIngest } from '../../../../app/service/ingest'
import { PrivateReplayArtifactStore, ReplayArtifactStoreUnavailableError } from '../../../../app/service/replay/artifacts'
import { createHash } from 'node:crypto'

const scope = { tenantId: '00000000-0000-4000-8000-000000000001', projectId: '00000000-0000-4000-8000-000000000002' }
const eventId = 'b2f35e73-0f73-4384-9e6f-08f9b4e4d2e5'
const instanceId = '83f3992a-6a55-4704-a032-9e56c9e65713'
const now = new Date('2026-09-12T10:00:00.000Z')

describe('PostgreSqlIngestWriter', () => {
  it('claims a receipt and writes its fact inside one transaction', async () => {
    const database = new RecordingDatabase()
    const payload = validateIngest('analytics', { key: 'zj_bro_key', events: [{ client_event_id: eventId, client_instance_id: instanceId, client_sequence: 1, kind: 'event', name: 'page_view', visitor_id: 'visitor', occurred_at: now.toISOString(), route: '/pricing' }] }, { now, pagePolicy: { allowedPageKeys: [ '/pricing' ], routeTemplates: [] } })
    if (payload.lane !== 'analytics') throw new Error('expected analytics payload')
    const result = await new PostgreSqlIngestWriter(database).write({ scope, lane: 'analytics', payload, clientEventIds: [ eventId ] })
    assert.deepEqual(result, { accepted: 1, duplicate: 0, sampled: 0, rate_limited: 0, dropped: 0 })
    assert.deepEqual(database.operations.map(operation => operation.text.startsWith('INSERT INTO ingest_receipts') ? 'receipt' : operation.text.startsWith('INSERT INTO events') ? 'event' : operation.text.startsWith('INSERT INTO usage_ledger_daily') ? 'usage' : operation.text), [ 'BEGIN', 'receipt', 'event', 'usage', 'COMMIT' ])
    assert.match(database.operations[1]!.text, /ON CONFLICT \(tenant_id, project_id, lane, client_event_id\)/)
    assert.equal(database.operations[1]?.values?.[6], Buffer.byteLength(JSON.stringify(payload.events[0]), 'utf8'))
  })

  it('records an unverified login as dropped and never writes an identity', async () => {
    const database = new RecordingDatabase()
    const payload = validateIngest('analytics', { key: 'zj_bro_key', events: [{ client_event_id: eventId, client_instance_id: instanceId, client_sequence: 1, kind: 'login', visitor_id: 'visitor', business_user_id: 'account', identity_assertion: 'untrusted', occurred_at: now.toISOString() }] }, { now, pagePolicy: { allowedPageKeys: [], routeTemplates: [] } })
    const result = await new PostgreSqlIngestWriter(database).write({ scope, lane: 'analytics', payload, clientEventIds: [ eventId ] })
    assert.equal(result.dropped, 1)
    assert.equal(database.operations.some(operation => /INSERT INTO identities/.test(operation.text)), false)
  })

  it('rolls back the receipt if fact persistence fails', async () => {
    const database = new RecordingDatabase('events')
    const payload = validateIngest('analytics', { key: 'zj_bro_key', events: [{ client_event_id: eventId, client_instance_id: instanceId, client_sequence: 1, kind: 'event', name: 'page_view', visitor_id: 'visitor', occurred_at: now.toISOString(), route: '/pricing' }] }, { now, pagePolicy: { allowedPageKeys: [ '/pricing' ], routeTemplates: [] } })
    await assert.rejects(() => new PostgreSqlIngestWriter(database).write({ scope, lane: 'analytics', payload, clientEventIds: [ eventId ] }), /exists without a matching ingest receipt/)
    assert.equal(database.operations.at(-1)?.text, 'ROLLBACK')
  })

  it('persists mobile declarations only after their receipt is accepted', async () => {
    const database = new RecordingDatabase()
    const payload = validateIngest('analytics', { key: 'zj_mob_key', events: [{ client_event_id: eventId, client_instance_id: instanceId, client_sequence: 1, kind: 'event', name: 'app_open', visitor_id: 'visitor', occurred_at: now.toISOString() }] }, { now, pagePolicy: { allowedPageKeys: [], routeTemplates: [] } })
    await new PostgreSqlIngestWriter(database).write({ scope, lane: 'analytics', payload, clientEventIds: [ eventId ], mobileDeclaration: { platform: 'ios', applicationId: 'com.example.app', applicationVersion: '1.2.3', verificationLevel: 'declaration_only' } })
    const declaration = database.operations.find(operation => operation.text.includes('INSERT INTO mobile_ingest_declarations'))
    assert.ok(declaration)
    assert.deepEqual(declaration?.values?.slice(4, 8), [ 'ios', 'com.example.app', '1.2.3', 'declaration_only' ])
    assert.ok(database.operations.findIndex(operation => operation.text.includes('INSERT INTO ingest_receipts')) < database.operations.findIndex(operation => operation.text.includes('INSERT INTO mobile_ingest_declarations')))
  })

  it('stores explicit dist, bounded frames, and only a verified replay association', async () => {
    const database = new RecordingDatabase()
    const payload = validateIngest('error', { key: 'zj_bro_key', events: [{ client_event_id: eventId, kind: 'error', visitor_id: 'visitor', occurred_at: now.toISOString(), release: 'web@1', dist: 'canary', replay_session_id: '83f3992a-6a55-4704-a032-9e56c9e65713', error: { mechanism: 'manual', type: 'Error', message: 'boom', frames: [{ filename: '/assets/app.js', line: 1, column: 0 }] } }] }, { now, pagePolicy: { allowedPageKeys: [], routeTemplates: [] } })
    if (payload.lane !== 'error') throw new Error('expected error')
    await new PostgreSqlIngestWriter(database).write({ scope, lane: 'error', payload, clientEventIds: [ eventId ] })
    const occurrence = database.operations.find(operation => operation.text.includes('INSERT INTO error_occurrences'))
    assert.ok(occurrence)
    assert.match(occurrence!.text, /release, dist, replay_session_id/)
    assert.equal(occurrence!.values?.[9], 'canary')
    assert.equal(occurrence!.values?.[10], null)
    assert.equal(occurrence!.values?.[15], JSON.stringify([{ filename: '/assets/app.js', line: 1, column: 0 }]))
    assert.ok(database.operations.some(operation => operation.text.includes('FROM replay_sessions AS sessions')))
  })

  it('replaces an allowlisted behavior token with a server HMAC and updates daily aggregates', async () => {
    const database = new RecordingDatabase()
    const payload = validateIngest('behavior', { key: 'zj_bro_key', events: [{ client_event_id: eventId, kind: 'behavior', visitor_id: 'visitor', occurred_at: now.toISOString(), page_key: '/pricing', page_version: 'r1', action: 'autocapture_click', element_token: 'save_button', viewport_width: 1200, viewport_height: 800, document_width: 1200, document_height: 1600, client_x: 20, client_y: 30, document_x: 20, document_y: 30 }] }, { now, pagePolicy: { allowedPageKeys: [ '/pricing' ], routeTemplates: [] } })
    await new PostgreSqlIngestWriter(database, undefined, undefined, undefined, undefined, 'this-is-a-long-enough-behavior-hmac-secret').write({ scope, lane: 'behavior', payload, behaviorPolicyVersion: 2, clientEventIds: [ eventId ] })
    const behavior = database.operations.find(operation => operation.text.includes('INSERT INTO behavior_events'))
    assert.match(String(behavior?.values?.[10]), /^[a-f0-9]{64}$/)
    assert.notEqual(behavior?.values?.[10], 'save_button')
    assert.ok(database.operations.some(operation => operation.text.includes('INSERT INTO heatmap_series_daily')))
    assert.ok(database.operations.some(operation => operation.text.includes('INSERT INTO heatmap_bins_daily')))
  })

  it('rejects replay before a receipt when private storage is absent', async () => {
    const payload = replayPayload()
    const database = new RecordingDatabase()
    await assert.rejects(() => new PostgreSqlIngestWriter(database).write({ scope, lane: 'replay', payload, clientEventIds: [ payload.request.chunks[0]!.chunk_id ] }), ReplayArtifactStoreUnavailableError)
    assert.equal(database.operations.some(operation => operation.text.includes('INSERT INTO ingest_receipts')), false)
  })

  it('removes a written replay object when database persistence rolls back', async () => {
    const payload = replayPayload()
    const database = new RecordingDatabase('replay_chunks')
    const store = new RecordingReplayStore()
    await assert.rejects(() => new PostgreSqlIngestWriter(database, undefined, undefined, store).write({ scope, lane: 'replay', payload, clientEventIds: [ payload.request.chunks[0]!.chunk_id ] }))
    assert.equal(store.puts.length, 1)
    assert.deepEqual(store.removed, [ store.puts[0]!.ref ])
    assert.equal(database.operations.at(-1)?.text, 'ROLLBACK')
  })
})

function replayPayload() {
  const raw = JSON.stringify({ version: 1, events: [{ t: 'checkout', at: now.getTime(), route: '/pricing', viewport: { width: 1200, height: 800 } }] })
  const chunkId = '83f3992a-6a55-4704-a032-9e56c9e65713'
  const payload = validateIngest('replay', { key: 'zj_bro_key', session: { replay_session_id: eventId, visitor_id: 'visitor', started_at: now.toISOString(), policy_version: 1, initial_route: '/pricing', sample_decision: true }, chunks: [{ chunk_id: chunkId, sequence_start: 0, sequence_end: 0, encoding: 'rrweb-json', data: Buffer.from(raw).toString('base64'), sha256: createHash('sha256').update(raw).digest('hex'), occurred_from: now.toISOString(), occurred_to: now.toISOString() }] }, { now, pagePolicy: { allowedPageKeys: [ '/pricing' ], routeTemplates: [] } })
  if (payload.lane !== 'replay') throw new Error('expected replay')
  return payload
}

class RecordingReplayStore implements PrivateReplayArtifactStore {
  readonly puts: Array<{ ref: string }> = []
  readonly removed: string[] = []
  async put(): Promise<{ ref: string; byteCount: number }> { const item = { ref: `replay/11111111-1111-4111-8111-111111111111.json` }; this.puts.push(item); return { ...item, byteCount: 2 } }
  async read(): Promise<Buffer | null> { return null }
  async remove(ref: string): Promise<void> { this.removed.push(ref) }
}

class RecordingDatabase implements DatabasePool, DatabaseTransaction {
  readonly operations: Array<{ text: string; values?: readonly unknown[] }> = []
  private readonly failTable: string | undefined
  constructor(failTable?: string) { this.failTable = failTable }
  async transaction<T>(run: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    this.operations.push({ text: 'BEGIN' })
    try { const result = await run(this); this.operations.push({ text: 'COMMIT' }); return result } catch (error) { this.operations.push({ text: 'ROLLBACK' }); throw error }
  }
  async query<Row extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
    this.operations.push({ text, values })
    if (text.includes('INSERT INTO error_groups') || text.includes('UPDATE error_groups') || text.includes('INSERT INTO identities') || text.includes('INSERT INTO replay_sessions')) return { rows: [], rowCount: 1 }
    if (text.includes('INSERT INTO worker_jobs')) return { rows: [{ id: '00000000-0000-4000-8000-000000000004' } as Row], rowCount: 1 }
    if (text.includes('SELECT id FROM error_groups')) return { rows: [{ id: '00000000-0000-4000-8000-000000000003' } as Row], rowCount: 1 }
    if (this.failTable && text.includes(`INSERT INTO ${this.failTable}`)) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 1 }
  }
  async commit(): Promise<void> {}
  async rollback(): Promise<void> {}
}
