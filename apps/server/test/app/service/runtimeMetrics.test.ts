import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { DatabaseClient, QueryResult } from '../../../app/service/database/types'
import { RuntimeMetricsService } from '../../../app/service/runtimeMetrics'

describe('RuntimeMetricsService', () => {
  it('returns aggregate queue health without tenant, project, lease owner, payload, or error fields', async () => {
    let query = ''
    const database: DatabaseClient = { query: async <Row extends object>(text: string): Promise<QueryResult<Row>> => {
      query = text
      return { rows: [{
        observed_at: new Date('2026-09-12T00:00:00Z'),
        outbox_available: '4', outbox_leased: '2', outbox_expired_leases: '1', outbox_oldest_available_age_seconds: '61.9',
        jobs_queued: '5', jobs_running: '3', jobs_failed: '1', jobs_available: '4', jobs_leased: '2', jobs_expired_leases: '1', jobs_oldest_available_age_seconds: null,
      } as Row], rowCount: 1 }
    } }

    const snapshot = await new RuntimeMetricsService(database).snapshot()

    assert.deepEqual(snapshot, {
      status: 'ok', observed_at: '2026-09-12T00:00:00.000Z',
      outbox: { available: 4, leased: 2, expired_leases: 1, oldest_available_age_seconds: 61 },
      jobs: { queued: 5, running: 3, failed: 1, available: 4, leased: 2, expired_leases: 1, oldest_available_age_seconds: null },
    })
    assert.match(query, /FROM outbox_messages/)
    assert.match(query, /FROM worker_jobs/)
    assert.match(query, /SELECT now\(\) AS observed_at/)
    assert.doesNotMatch(query, /clock\.observed_at/)
    assert.doesNotMatch(query, /tenant_id|project_id|lease_owner|payload|last_error_code/)
  })

  it('rejects malformed database aggregates instead of reporting misleading health', async () => {
    const database: DatabaseClient = { query: async <Row extends object>(): Promise<QueryResult<Row>> => ({ rows: [{
      observed_at: new Date(), outbox_available: '-1', outbox_leased: '0', outbox_expired_leases: '0', outbox_oldest_available_age_seconds: null,
      jobs_queued: '0', jobs_running: '0', jobs_failed: '0', jobs_available: '0', jobs_leased: '0', jobs_expired_leases: '0', jobs_oldest_available_age_seconds: null,
    } as Row], rowCount: 1 }) }
    await assert.rejects(new RuntimeMetricsService(database).snapshot(), /count is invalid/)
  })
})
