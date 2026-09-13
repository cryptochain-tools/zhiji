import assert from 'node:assert/strict'
import test from 'node:test'
import { AlertEvaluationHandler } from '../src/alerts'
import { LeasedWorkerJob } from '../../server/app/service/worker'

const tenant = '00000000-0000-4000-8000-000000000001'
const project = '00000000-0000-4000-8000-000000000002'
const rule = '00000000-0000-4000-8000-000000000003'
const group = '00000000-0000-4000-8000-000000000004'
function job(): LeasedWorkerJob { return { id: '00000000-0000-4000-8000-000000000005', tenant_id: tenant, project_id: project, kind: 'alert_evaluation', idempotency_key: 'x', payload: {}, watermark: {}, lease_owner: 'test', lease_expires_at: new Date(), attempt_count: 1, max_attempts: 5, processed_count: 0, failed_count: 0 } }

test('evaluates only enabled project-scoped rules and queues id-only notification delivery', async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = []
  const connection = {
    async query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values })
      if (text === 'BEGIN' || text === 'COMMIT') return { rows: [] as T[], rowCount: 0 }
      if (text.includes('FROM projects')) return { rows: [{ id: project }] as T[], rowCount: 1 }
      if (text.includes('FROM alert_rules')) return { rows: [{ id: rule, rule_type: 'error_count', condition_json: { window_seconds: 300, threshold: 2 }, created_at: new Date('2026-09-12') }] as T[], rowCount: 1 }
      if (text.includes('FROM error_occurrences')) return { rows: [{ group_key: group + ':300', summary: { count: 2, window_seconds: 300, release: 'v1' } }] as T[], rowCount: 1 }
      if (text.includes('WITH locked')) return { rows: [{ id: '00000000-0000-4000-8000-000000000006', enqueued: true }] as T[], rowCount: 1 }
      if (text.includes('WITH targets')) return { rows: [{ id: 'x' }] as T[], rowCount: 1 }
      return { rows: [] as T[], rowCount: 0 }
    }, release() {},
  }
  const database = { async connect() { return connection } }
  const result = await new AlertEvaluationHandler(database as never).runJob(job())
  assert.equal(result.processedCount, 1)
  assert.equal(result.watermark?.delivery_candidates, 1)
  const queued = calls.find(call => call.text.includes("'notification_delivery'"))
  assert.ok(queued)
  assert.match(queued.text, /jsonb_build_object\('notification_delivery_id', id\)/)
  assert.doesNotMatch(queued.text, /endpoint|secret|stack|visitor/i)
})

test('rejects invalid persisted conditions instead of evaluating arbitrary SQL-like configuration', async () => {
  const connection = { async query<T = Record<string, unknown>>(text: string) {
    if (text === 'BEGIN' || text === 'ROLLBACK') return { rows: [] as T[], rowCount: 0 }
    if (text.includes('FROM projects')) return { rows: [{ id: project }] as T[], rowCount: 1 }
    if (text.includes('FROM alert_rules')) return { rows: [{ id: rule, rule_type: 'error_count', condition_json: { window_seconds: 'bad', threshold: 1 }, created_at: new Date() }] as T[], rowCount: 1 }
    return { rows: [] as T[], rowCount: 0 }
  }, release() {} }
  await assert.rejects(() => new AlertEvaluationHandler({ async connect() { return connection } } as never).runJob(job()), /invalid_alert_rule_condition/)
})
