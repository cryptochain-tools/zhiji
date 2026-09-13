import assert from 'node:assert/strict'
import test from 'node:test'
import { AnalyticsExportJobHandler } from '../src/analytics-exports'
import { LeasedWorkerJob } from '../../server/app/service/worker'

const tenant = '00000000-0000-4000-8000-000000000001'; const project = '00000000-0000-4000-8000-000000000002'; const exportId = '00000000-0000-4000-8000-000000000003'
function job(): LeasedWorkerJob { return { id: '00000000-0000-4000-8000-000000000004', tenant_id: tenant, project_id: project, kind: 'report_export', idempotency_key: 'test', payload: { export_job_id: exportId }, watermark: {}, lease_owner: 'worker', lease_expires_at: new Date(), attempt_count: 1, max_attempts: 1, processed_count: 0, failed_count: 0 } }

test('analytics export fails closed before any aggregate query without a private artifact store', async () => {
  const calls: string[] = []; const database = { async query<T extends object>(text: string) { calls.push(text); return { rows: [] as T[], rowCount: 1 } } }
  const result = await new AnalyticsExportJobHandler(database).runJob(job())
  assert.equal(result.failedCount, 1); assert.equal(result.watermark?.terminal_reason, 'artifact_store_unavailable')
  assert.ok(calls.some(text => text.includes("status=CASE WHEN expires_at<=now() THEN 'expired' ELSE 'failed' END")))
  assert.equal(calls.some(text => text.includes('FROM events')), false)
})

test('bad frozen definitions fail terminally and never write an artifact', async () => {
  const calls: string[] = []; let writes = 0
  const database = { async query<T extends object>(text: string) { calls.push(text); if (text.includes("status='running'")) return { rows: [{ id: exportId, tenant_id: tenant, project_id: project, requested_by: '00000000-0000-4000-8000-000000000005', format: 'csv', definition: { kind: 'events' }, status: 'running', expires_at: new Date(Date.now() + 60_000) }] as T[], rowCount: 1 }; return { rows: [] as T[], rowCount: 1 } } }
  const store = { async put() { writes++; return { ref: 'analytics-export/00000000-0000-4000-8000-000000000000.csv', byteCount: 2 } }, async read() { return null }, async remove() {} }
  const result = await new AnalyticsExportJobHandler(database, store).runJob(job())
  assert.equal(result.failedCount, 1); assert.equal(writes, 0); assert.ok(calls.some(text => text.includes("status=CASE WHEN expires_at<=now()")))
})
