import assert from 'node:assert/strict'
import { AnalyticsRepository } from '../../../../app/service/analytics/repository'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'

describe('AnalyticsRepository', () => {
  it('keeps trend scope and event names parameterized', async () => {
    let call: { text: string; values: readonly unknown[] | undefined } | undefined
    const db: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      call = { text, values }; return { rows: [], rowCount: 0 }
    } }
    await new AnalyticsRepository(db).trend({ tenantId: 'tenant', projectId: 'project', from: new Date('2026-09-10T00:00:00Z'), to: new Date('2026-09-12T00:00:00Z'), granularity: 'day', eventNames: [ "signup'); drop table events; --" ] })
    assert.match(call!.text, /tenant_id = \$1 AND project_id = \$2/)
    assert.match(call!.text, /name = ANY\(\$6::text\[\]\)/)
    assert.deepEqual(call!.values?.[5], [ "signup'); drop table events; --" ])
  })
  it('keeps event explorer filters as values and fixes the only selectable grouping expressions', async () => {
    let call: { text: string; values: readonly unknown[] | undefined } | undefined
    const db: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => { call = { text, values }; return { rows: [], rowCount: 0 } } }
    await new AnalyticsRepository(db).events({ tenantId: 'tenant', projectId: 'project', from: new Date('2026-09-10T00:00:00Z'), to: new Date('2026-09-12T00:00:00Z'), filters: [{ key: "plan');drop", value: 'pro' }], groupBy: 'route', limit: 20 })
    assert.match(call!.text, /properties -> \$5 = \$6::jsonb/)
    assert.match(call!.text, /COALESCE\(route, '\(none\)'\)/)
    assert.deepEqual(call!.values?.slice(4, 6), [ "plan');drop", '"pro"' ])
  })
})
