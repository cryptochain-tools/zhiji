import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'
import { UsageManagementService } from '../../../../app/service/usage'
import { UsageLedgerRepository } from '../../../../app/service/usage/repository'

describe('UsageManagementService', () => {
  it('returns daily rows and totals without identity joins', async () => {
    const database: DatabaseClient = { async query<Row extends object>(): Promise<QueryResult<Row>> { return { rows: [ { usage_date: '2026-09-12', lane: 'analytics', received_events: 2, received_bytes: 42 } as Row ], rowCount: 1 } } }
    const result = await new UsageManagementService(new UsageLedgerRepository(database)).show({ tenantId: 'tenant', projectId: 'project' }, { from: '2026-09-12T00:00:00Z', to: '2026-09-13T00:00:00Z' }, new Date('2026-09-14T00:00:00Z'))
    assert.deepEqual(result.totals, { received_events: 2, received_bytes: 42 })
    assert.equal(result.daily[0]?.usage_date, '2026-09-12')
  })

  it('rejects unbounded or unknown lanes before database access', async () => {
    let called = false
    const database: DatabaseClient = { async query<Row extends object>(): Promise<QueryResult<Row>> { called = true; return { rows: [], rowCount: 0 } } }
    await assert.rejects(() => new UsageManagementService(new UsageLedgerRepository(database)).show({ tenantId: 'tenant', projectId: 'project' }, { from: '2026-01-01T00:00:00Z', to: '2026-09-13T00:00:00Z' }, new Date('2026-09-14T00:00:00Z')), (error: Error & { code?: string }) => error.code === 'invalid_usage_query')
    await assert.rejects(() => new UsageManagementService(new UsageLedgerRepository(database)).show({ tenantId: 'tenant', projectId: 'project' }, { lane: 'other' }, new Date('2026-09-14T00:00:00Z')), (error: Error & { code?: string }) => error.code === 'invalid_usage_query')
    await assert.rejects(() => new UsageManagementService(new UsageLedgerRepository(database)).show({ tenantId: 'tenant', projectId: 'project' }, { from: '2026-09-12T12:00:00Z', to: '2026-09-13T00:00:00Z' }, new Date('2026-09-14T00:00:00Z')), (error: Error & { code?: string }) => error.code === 'invalid_usage_query')
    assert.equal(called, false)
  })
})
