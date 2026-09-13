import assert from 'node:assert/strict'
import { AdvancedAnalyticsManagementService } from '../../../../app/service/advancedAnalytics'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'

describe('AdvancedAnalyticsManagementService', () => {
  const scope = { tenantId: 'tenant', projectId: 'project' }
  const now = new Date('2026-09-12T12:00:00Z')
  it('returns retention denominators, zero-safe rates and identity attribution', async () => {
    const db: DatabaseClient = { query: async <Row extends object>(): Promise<QueryResult<Row>> => ({ rows: [{ cohort_bucket: '2026-09-01T00:00:00Z', cohort_size: '2', retained_1: '1', retained_2: '0', source_event_count: '9' } as Row], rowCount: 1 }) }
    const result = await new AdvancedAnalyticsManagementService(db).retention(scope, { from: '2026-09-01T00:00:00Z', to: '2026-09-12T00:00:00Z', start_event: 'signup', return_event: 'page_view', period: 'week', period_count: 2, subject_kind: 'business_user', timezone: 'UTC' }, now)
    assert.equal(result.subject_kind, 'business_user')
    assert.equal(result.identity_attribution, 'all_linked')
    assert.equal(result.facts_deduplicated, true)
    assert.deepEqual(result.cohorts[0]?.retained, [ { period: 1, count: 1, rate: 50 }, { period: 2, count: 0, rate: 0 } ])
  })
  it('caps every path parent at ten nodes and reports omitted branch contributions as Other', async () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({ depth: 2, parent_path: [ 'start' ], name: `event-${index}`, subject_count: 12 - index, source_event_count: 30 }))
    const db: DatabaseClient = { query: async <Row extends object>(): Promise<QueryResult<Row>> => ({ rows: rows as Row[], rowCount: rows.length }) }
    const result = await new AdvancedAnalyticsManagementService(db).path(scope, { from: '2026-09-01T00:00:00Z', to: '2026-09-12T00:00:00Z', start_event: 'start', depth: 3, subject_kind: 'visitor' }, now)
    assert.equal(result.levels[0]?.nodes.length, 10)
    assert.equal(result.levels[0]?.other_count, 3)
    assert.equal(result.source_event_count, 30)
  })
})
