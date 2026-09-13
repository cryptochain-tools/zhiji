import assert from 'node:assert/strict'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'
import { FunnelRepository } from '../../../../app/service/funnel/repository'

describe('FunnelRepository', () => {
  const base = {
    tenantId: 'tenant', projectId: 'project', from: new Date('2026-09-10T00:00:00Z'), to: new Date('2026-09-12T00:00:00Z'), steps: [ 'signup', 'purchase' ], subjectKind: 'visitor' as const,
  }

  it('keeps scope and every event name parameterized while requiring a provable event order', async () => {
    let call: { text: string; values?: readonly unknown[] } | undefined
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      call = { text, values }; return { rows: [{ step_1_count: '3', step_2_count: '2' } as Row], rowCount: 1 }
    } }
    const result = await new FunnelRepository(database).counts({ ...base, steps: [ "signup'); drop table events; --", 'purchase' ] })
    assert.deepEqual(result, { steps: [ { name: "signup'); drop table events; --", count: 3 }, { name: 'purchase', count: 2 } ], sourceEventCount: 0 })
    assert.match(call!.text, /tenant_id = \$1 AND project_id = \$2/)
    assert.match(call!.text, /name = ANY\(\$5::text\[\]\)/)
    assert.match(call!.text, /current\.occurred_at > previous\.occurred_at/)
    assert.match(call!.text, /current\.client_instance_id = previous\.client_instance_id/)
    assert.match(call!.text, /current\.client_sequence > previous\.client_sequence/)
    assert.deepEqual(call!.values?.[4], [ "signup'); drop table events; --", 'purchase' ])
    assert.deepEqual(call!.values?.slice(5), [ "signup'); drop table events; --", 'purchase' ])
  })

  it('expands all facts only to same-project verified business identities', async () => {
    let text = ''
    const database: DatabaseClient = { query: async <Row extends object>(query: string): Promise<QueryResult<Row>> => {
      text = query; return { rows: [], rowCount: 0 }
    } }
    await new FunnelRepository(database).counts({ ...base, subjectKind: 'business_user' })
    assert.match(text, /JOIN identities i ON i\.tenant_id = \$1 AND i\.project_id = \$2 AND i\.visitor_id = e\.visitor_id/)
    assert.match(text, /SELECT DISTINCT e\.id/)
  })
})
