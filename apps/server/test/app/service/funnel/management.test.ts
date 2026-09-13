import assert from 'node:assert/strict'
import { FunnelManagementService, normalizeFunnelInput } from '../../../../app/service/funnel'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'

describe('FunnelManagementService', () => {
  const scope = { tenantId: 'tenant', projectId: 'project' }
  const input = { from: '2026-09-10T00:00:00Z', to: '2026-09-12T00:00:00Z', steps: 'view, signup, purchase', subject_kind: 'business_user' }

  it('returns stable counts, conversions and dropoffs with the selected identity kind', async () => {
    const database: DatabaseClient = { query: async <Row extends object>(): Promise<QueryResult<Row>> => ({
      rows: [{ source_event_count: '18', step_1_count: '10', step_2_count: '4', step_3_count: '0' } as Row], rowCount: 1,
    }) }
    const result = await new FunnelManagementService(database).show(scope, input, new Date('2026-09-12T03:00:00Z'))
    assert.equal(result.subject_kind, 'business_user')
    assert.equal(result.identity_attribution, 'all_linked')
    assert.equal(result.facts_deduplicated, true)
    assert.equal(result.source_event_count, 18)
    assert.equal(result.timezone, 'UTC')
    assert.equal(result.truncated, false)
    assert.match(result.query_hash, /^[a-f0-9]{64}$/)
    assert.deepEqual(result.steps, [
      { name: 'view', count: 10, conversion: 100, dropoff: 0 },
      { name: 'signup', count: 4, conversion: 40, dropoff: 6 },
      { name: 'purchase', count: 0, conversion: 0, dropoff: 4 },
    ])
  })

  it('uses zero conversion for every step when the preceding step is empty', async () => {
    const database: DatabaseClient = { query: async <Row extends object>(): Promise<QueryResult<Row>> => ({
      rows: [{ source_event_count: 0, step_1_count: 0, step_2_count: 0 } as Row], rowCount: 1,
    }) }
    const result = await new FunnelManagementService(database).show(scope, { ...input, steps: 'view,purchase', subject_kind: 'visitor' }, new Date('2026-09-12T03:00:00Z'))
    assert.deepEqual(result.steps, [
      { name: 'view', count: 0, conversion: 0, dropoff: 0 },
      { name: 'purchase', count: 0, conversion: 0, dropoff: 0 },
    ])
  })

  it('only normalizes the HTTP comma-separated representation', async () => {
    assert.deepEqual(normalizeFunnelInput(input), { ...input, steps: [ 'view', 'signup', 'purchase' ] })
    await assert.rejects(
      new FunnelManagementService({ query: async () => ({ rows: [], rowCount: 0 }) }).show(
        scope, { ...input, steps: 'view,,purchase' }, new Date('2026-09-12T03:00:00Z'),
      ),
      { code: 'invalid_funnel_query' },
    )
  })
})
