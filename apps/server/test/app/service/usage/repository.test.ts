import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'
import { UsageLedgerRepository } from '../../../../app/service/usage/repository'

describe('UsageLedgerRepository', () => {
  it('upserts accepted canonical bytes by tenant, project, UTC day and lane', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = { async query<Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> { calls.push({ text, values }); return { rows: [], rowCount: 1 } } }
    await new UsageLedgerRepository(database).recordAccepted({ tenantId: 'tenant', projectId: 'project', lane: 'analytics', receivedAt: new Date('2026-09-12T23:59:00Z'), receivedBytes: 123 })
    assert.match(calls[0]?.text ?? '', /ON CONFLICT \(tenant_id, project_id, usage_date, lane\)/)
    assert.match(calls[0]?.text ?? '', /received_events = usage_ledger_daily\.received_events \+ 1/)
    assert.deepEqual(calls[0]?.values?.slice(0, 2), [ 'tenant', 'project' ])
    assert.equal(calls[0]?.values?.[4], 123)
  })

  it('reads a bounded, parameterized project range and can rebuild from receipts', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = { async query<Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> { calls.push({ text, values }); return { rows: [ { usage_date: '2026-09-12', lane: 'error', received_events: 2, received_bytes: 99 } as Row ], rowCount: 1 } } }
    const repository = new UsageLedgerRepository(database)
    const scope = { tenantId: 'tenant', projectId: 'project' }
    const query = { from: new Date('2026-09-12T00:00:00Z'), to: new Date('2026-09-13T00:00:00Z'), lane: 'error' as const }
    const rows = await repository.daily(scope, query)
    await repository.rebuild(scope, query)
    assert.deepEqual(rows, [ { usage_date: '2026-09-12', lane: 'error', received_events: 2, received_bytes: 99 } ])
    assert.match(calls[0]?.text ?? '', /tenant_id = \$1 AND project_id = \$2/)
    assert.equal(calls[0]?.values?.[4], 'error')
    assert.match(calls[2]?.text ?? '', /FROM ingest_receipts/)
    assert.match(calls[2]?.text ?? '', /decision = 'accepted' AND received_bytes IS NOT NULL/)
  })
})
