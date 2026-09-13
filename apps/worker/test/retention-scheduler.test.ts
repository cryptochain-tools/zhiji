import assert from 'node:assert/strict'
import test from 'node:test'
import { RetentionScheduleScanner } from '../src/retention-scheduler'
import { DatabaseClient, QueryResult } from '../../server/app/service/database/types'

test('retention scanner creates tenant/project-scoped daily cleanup jobs without a mutable cursor', async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = []
  const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
    calls.push({ text, values })
    if (text.includes('FROM projects')) return { rows: [{ tenant_id: '11111111-1111-4111-8111-111111111111', project_id: '22222222-2222-4222-8222-222222222222' } as Row], rowCount: 1 }
    return { rows: [{ inserted: true } as Row], rowCount: 1 }
  } }
  const result = await new RetentionScheduleScanner(database, () => new Date('2026-09-12T11:22:33.000Z')).scan()
  assert.deepEqual(result, { projects: 1, retentionJobs: 1, sourceMapJobs: 1 })
  assert.match(calls[0]!.text, /deletion_status='active'/)
  assert.equal(calls.filter(call => call.text.includes('INSERT INTO worker_jobs')).length, 2)
  for (const call of calls.slice(1)) { assert.match(call.text, /ON CONFLICT\(tenant_id,project_id,kind,idempotency_key\)/); assert.match(String(call.values?.[4]), /:2026-09-12$/) }
})
