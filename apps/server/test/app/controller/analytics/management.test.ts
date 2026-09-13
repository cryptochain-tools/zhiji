import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { AnalyticsManagementService } from '../../../../app/service/analytics'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'

describe('AnalyticsManagementService', () => {
  it('normalizes an HTTP event_names query and retains tenant/project scope', async () => {
    let call: { text: string; values?: readonly unknown[] } | undefined
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      call = { text, values }
      return { rows: [{ bucket_start: new Date('2026-09-12T00:00:00Z'), event_name: 'page_view', event_count: 3, page_views: 3, visitors: 2 } as Row], rowCount: 1 }
    } }
    const result = await new AnalyticsManagementService(database).trend(
      { tenantId: 'tenant', projectId: 'project' },
      { from: '2026-09-11T00:00:00Z', to: '2026-09-12T01:00:00Z', granularity: 'hour', event_names: 'page_view, signup' },
      new Date('2026-09-12T02:00:00Z'),
    )
    assert.equal(result.points[0]?.event_count, 3)
    assert.match(call!.text, /tenant_id = \$1 AND project_id = \$2/)
    assert.deepEqual(call!.values?.slice(0, 2), [ 'tenant', 'project' ])
    assert.deepEqual(call!.values?.[5], [ 'page_view', 'signup' ])
  })

  it('rejects unbounded analytics requests before querying', async () => {
    let called = false
    const database: DatabaseClient = { query: async <Row extends object>(): Promise<QueryResult<Row>> => { called = true; return { rows: [], rowCount: 0 } } }
    await assert.rejects(
      new AnalyticsManagementService(database).trend({ tenantId: 'tenant', projectId: 'project' }, { from: '2025-01-01T00:00:00Z', to: '2026-09-12T00:00:00Z', granularity: 'day', event_names: 'page_view' }, new Date('2026-09-12T00:00:00Z')),
      (error: Error & { code?: string }) => error.code === 'invalid_analytics_query',
    )
    assert.equal(called, false)
  })
})
