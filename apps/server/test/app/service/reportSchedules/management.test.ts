import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { ReportSchedulesManagementService } from '../../../../app/service/reportSchedules'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'

const scope = { tenantId: '20000000-0000-4000-8000-000000000001', projectId: '20000000-0000-4000-8000-000000000002' }
const id = '20000000-0000-4000-8000-000000000003'
const target = '20000000-0000-4000-8000-000000000004'
const actor = '20000000-0000-4000-8000-000000000005'
const created = new Date('2026-09-12T00:00:00.000Z')
const nextRunAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
const record = { id, target_type: 'insight', target_id: target, cadence: 'daily', timezone: 'UTC', next_run_at: nextRunAt, enabled: true, notification_target_id: target, created_by: actor, updated_by: actor, created_at: created, updated_at: created, latest_run_id: null, latest_run_status: null, latest_run_scheduled_for: null, latest_run_finished_at: null, latest_run_error_code: null }

describe('ReportSchedulesManagementService', () => {
  it('lists scoped schedules with only sanitized configuration and run summary', async () => {
    let call: { text: string; values?: readonly unknown[] } | undefined
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => { call = { text, values }; return { rows: [record as Row], rowCount: 1 } } }
    const result = await new ReportSchedulesManagementService(database).list(scope, { limit: '1' })
    assert.equal(result.items[0]?.id, id)
    assert.equal(result.items[0]?.latest_run, null)
    assert.match(call!.text, /schedule\.tenant_id = \$1 AND schedule\.project_id = \$2/)
    assert.doesNotMatch(JSON.stringify(result), /secret|webhook|https?:/i)
  })
  it('creates only when the scoped verified notification and report target both exist', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    let count = 0
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => { calls.push({ text, values }); count += 1; return { rows: (count === 1 ? [{ id }] : [record]) as Row[], rowCount: 1 } } }
    const result = await new ReportSchedulesManagementService(database).create(scope, actor, { target_type: 'insight', target_id: target, cadence: 'daily', timezone: 'UTC', next_run_at: nextRunAt.toISOString(), enabled: true, notification_target_id: target })
    assert.equal(result.id, id)
    assert.match(calls[0]?.text ?? '', /notification_targets WHERE tenant_id = \$1 AND project_id = \$2 AND id = \$8 AND enabled AND verified_at IS NOT NULL/)
    assert.match(calls[0]?.text ?? '', /saved_insights WHERE tenant_id = \$1 AND project_id = \$2 AND id = \$4 AND archived_at IS NULL AND visibility = 'project'/)
    assert.match(calls[0]?.text ?? '', /dashboards WHERE tenant_id = \$1 AND project_id = \$2 AND id = \$4 AND archived_at IS NULL/)
  })
  it('requires the current update timestamp for disable and makes disable a non-destructive state transition', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    let count = 0
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => { calls.push({ text, values }); count += 1; return { rows: (count === 1 ? [{ id }] : [{ ...record, enabled: false }]) as Row[], rowCount: 1 } } }
    const result = await new ReportSchedulesManagementService(database).disable(scope, id, actor, { expected_updated_at: created.toISOString() })
    assert.equal(result.enabled, false)
    assert.match(calls[0]?.text ?? '', /UPDATE report_schedules SET enabled = false/)
    assert.match(calls[0]?.text ?? '', /date_trunc\('milliseconds', updated_at\) = \$5 AND enabled/)
  })
})

it('requeues only a failed run under the same scoped enabled schedule and gives it a bounded retry identity', async () => {
  const run = '20000000-0000-4000-8000-000000000006'; const calls: Array<{ text: string; values?: readonly unknown[] }> = []
  const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => { calls.push({ text, values }); return { rows: [{ id: run, retry_count: 1 }] as Row[], rowCount: 1 } } }
  const result = await new ReportSchedulesManagementService(database).retryRun(scope, id, run, actor)
  assert.deepEqual(result, { run_id: run, status: 'queued', retry_count: 1 })
  const query = calls[0]?.text ?? ''
  assert.match(query, /run\.status='failed' AND run\.retry_count<3/)
  assert.match(query, /report-schedule-retry:/)
  assert.match(query, /notification_targets target/)
  assert.match(query, /projects project/)
  assert.doesNotMatch(query, /webhook|secret|artifact_ref/i)
})
