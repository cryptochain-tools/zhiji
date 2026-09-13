import assert from 'node:assert/strict'
import { ReportingRepository } from '../../../../app/service/reporting/repository'
import { DatabaseClient } from '../../../../app/service/database/types'

describe('ReportingRepository', () => {
  it('keeps quantile aggregation parameterized and project-scoped', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = { async query<Row extends object>(text: string, values?: readonly unknown[]) { calls.push({ text, values }); return { rows: [] as Row[], rowCount: 0 } } }
    await new ReportingRepository(database).performance({ tenantId: 'tenant', projectId: 'project' }, { from: new Date('2026-01-01'), to: new Date('2026-01-02'), metric: 'LCP' })
    assert.match(calls[0]?.text ?? '', /percentile_cont\(0\.75\)/)
    assert.deepEqual(calls[0]?.values?.slice(0, 2), [ 'tenant', 'project' ])
  })
  it('keeps page detail aggregates scoped and does not select private observations', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = { async query<Row extends object>(text: string, values?: readonly unknown[]) { calls.push({ text, values }); return { rows: [] as Row[], rowCount: 0 } } }
    await new ReportingRepository(database).performanceDetail({ tenantId: 'tenant', projectId: 'project' }, { from: new Date('2026-01-01'), to: new Date('2026-01-02'), metric: 'LCP', pageKey: '/checkout/:id' })
    assert.equal(calls.length, 2)
    for (const call of calls) {
      assert.deepEqual(call.values?.slice(0, 4), [ 'tenant', 'project', '/checkout/:id', 'LCP' ])
      assert.match(call.text, /percentile_cont\(0\.75\)/)
      assert.doesNotMatch(call.text, /visitor_id|business_user_id|route|browser|device/i)
    }
    assert.match(calls[0]?.text ?? '', /navigation_scope/)
  })

})
