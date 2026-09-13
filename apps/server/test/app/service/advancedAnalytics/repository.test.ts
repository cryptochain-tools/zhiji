import assert from 'node:assert/strict'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'
import { AdvancedAnalyticsRepository } from '../../../../app/service/advancedAnalytics/repository'

describe('AdvancedAnalyticsRepository', () => {
  const scope = { tenantId: 'tenant', projectId: 'project', from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-12T00:00:00Z') }
  it('keeps retention scope, names and timezone parameterized before identity expansion', async () => {
    let call: { text: string; values?: readonly unknown[] } | undefined
    const db: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => { call = { text, values }; return { rows: [{ cohort_bucket: '2026-09-01T00:00:00Z', cohort_size: '3', retained_1: '2', retained_2: '1', source_event_count: '12' } as Row], rowCount: 1 } } }
    const result = await new AdvancedAnalyticsRepository(db).retention({ ...scope, startEvent: "sign');drop", returnEvent: 'page_view', period: 'week', periodCount: 2, subjectKind: 'business_user', timezone: 'Asia/Shanghai' })
    assert.deepEqual(result.rows[0], { cohortBucket: new Date('2026-09-01T00:00:00Z'), cohortSize: 3, retained: [ 2, 1 ] })
    assert.equal(result.sourceEventCount, 12)
    assert.match(call!.text, /tenant_id = \$1 AND project_id = \$2/)
    assert.match(call!.text, /JOIN identities i ON i\.tenant_id = \$1 AND i\.project_id = \$2 AND i\.visitor_id = e\.visitor_id/)
    assert.match(call!.text, /occurred_at AT TIME ZONE \$5/)
    assert.deepEqual(call!.values, [ 'tenant', 'project', scope.from, scope.to, 'Asia/Shanghai', "sign');drop", 'page_view' ])
  })
  it('uses strict timestamp, instance, sequence and id ordering for a bounded same-subject path', async () => {
    let text = ''
    const db: DatabaseClient = { query: async <Row extends object>(sql: string): Promise<QueryResult<Row>> => { text = sql; return { rows: [], rowCount: 0 } } }
    await new AdvancedAnalyticsRepository(db).path({ ...scope, startEvent: 'page_view', depth: 5, subjectKind: 'visitor' })
    assert.match(text, /WITH RECURSIVE scoped_events/)
    assert.match(text, /e\.subject_id = p\.subject_id/)
    assert.match(text, /e\.name <> 'login'/)
    assert.match(text, /e\.name <> p\.name/)
    assert.match(text, /e\.occurred_at > p\.occurred_at/)
    assert.match(text, /e\.client_instance_id > p\.client_instance_id/)
    assert.match(text, /e\.client_sequence > p\.client_sequence/)
    assert.match(text, /e\.id > p\.id/)
    assert.match(text, /p\.depth < \$6::integer/)
  })
})
