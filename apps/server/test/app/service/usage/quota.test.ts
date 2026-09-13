import assert from 'node:assert/strict'
import { DatabasePool, DatabaseTransaction, QueryResult } from '../../../../app/service/database/types'
import { PostgreSqlUsageQuotaEnforcer, QuotaExceededError } from '../../../../app/service/usage/quota'

const tenantId = '00000000-0000-4000-8000-000000000001'

describe('PostgreSqlUsageQuotaEnforcer', () => {
  it('records cycle usage while hard limits are disabled', async () => {
    const database = new QuotaDatabase({ hard_limit_enabled: false, included_events: 1 })
    await new PostgreSqlUsageQuotaEnforcer().consume(database, { tenantId, lane: 'analytics', acceptedEvents: 2, acceptedBytes: 10 })
    assert.ok(database.calls.some(call => call.text.includes('INSERT INTO usage_cycle_counters')))
  })

  it('uses the synchronous cycle counter, not the daily ledger, for an enabled hard limit', async () => {
    const database = new QuotaDatabase({ hard_limit_enabled: true, included_events: 10, accepted_events: 9 })
    await assert.rejects(() => new PostgreSqlUsageQuotaEnforcer().consume(database, { tenantId, lane: 'analytics', acceptedEvents: 2, acceptedBytes: 10 }), (error: unknown) => error instanceof QuotaExceededError && error.resetsAt.toISOString() === '2026-10-01T00:00:00.000Z')
    assert.equal(database.calls.some(call => call.text.includes('usage_ledger_daily')), false)
    assert.equal(database.calls.some(call => call.text.includes('INSERT INTO usage_cycle_counters')), false)
  })

  it('applies a configured grace percentage before rejecting', async () => {
    const database = new QuotaDatabase({ hard_limit_enabled: true, included_events: 10, grace_percent: 20, accepted_events: 10 })
    await new PostgreSqlUsageQuotaEnforcer().consume(database, { tenantId, lane: 'analytics', acceptedEvents: 2, acceptedBytes: 1 })
    assert.ok(database.calls.some(call => call.text.includes('INSERT INTO usage_cycle_counters')))
  })
})

class QuotaDatabase implements DatabasePool, DatabaseTransaction {
  readonly calls: Array<{ text: string; values?: readonly unknown[] }> = []
  private readonly values: Partial<{ hard_limit_enabled: boolean; included_events: number; grace_percent: number; accepted_events: number }>
  constructor(values: Partial<{ hard_limit_enabled: boolean; included_events: number; grace_percent: number; accepted_events: number }>) { this.values = values }
  async transaction<T>(run: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> { return run(this) }
  async query<Row extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
    this.calls.push({ text, values })
    if (text.includes('FROM subscriptions s JOIN plans')) return { rows: [ {
      id: '00000000-0000-4000-8000-000000000009', cycle_started_at: new Date('2026-09-01T00:00:00.000Z'), cycle_ends_at: new Date('2026-10-01T00:00:00.000Z'),
      hard_limit_enabled: this.values.hard_limit_enabled ?? false, grace_percent: this.values.grace_percent ?? 0,
      included_events: this.values.included_events ?? 100, included_errors: 100, included_behavior_events: 100, included_replay_bytes: 100,
    } as Row ], rowCount: 1 }
    if (text.includes('FROM usage_cycle_counters')) return { rows: [ {
      accepted_events: this.values.accepted_events ?? 0, accepted_bytes: 0, adjustment_events: 0, adjustment_bytes: 0,
    } as Row ], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }
  async commit(): Promise<void> {}
  async rollback(): Promise<void> {}
}
