import assert from 'node:assert/strict'
import { WorkerRepository } from '../../../../app/service/worker/repository'
import { WorkerRepositoryDatabase } from '../../../../app/service/worker/types'

function databaseWith(calls: Array<{ text: string; values?: readonly unknown[] }>, rows: object[] = [], rowCount = 0): WorkerRepositoryDatabase {
  return {
    async query<Row extends object>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values })
      return { rows: rows as Row[], rowCount }
    },
  }
}

describe('WorkerRepository', () => {
  it('enqueues outbox entries with topic scoped idempotency and no plaintext payload interpolation', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database = databaseWith(calls, [ { id: 'outbox-id', inserted: true } ], 1)
    const repository = new WorkerRepository(database)
    const result = await repository.enqueueOutbox({ id: 'outbox-id', tenantId: 'tenant', projectId: 'project', topic: 'alert', idempotencyKey: 'incident-1', payload: { unsafe: "' OR 1=1" } })

    assert.deepEqual(result, { id: 'outbox-id', inserted: true })
    assert.match(calls[0]?.text ?? '', /ON CONFLICT \(tenant_id, project_id, topic, idempotency_key\)/)
    assert.ok(!(calls[0]?.text ?? '').includes("' OR 1=1"))
    assert.equal(calls[0]?.values?.[5], JSON.stringify({ unsafe: "' OR 1=1" }))
  })

  it('claims only available expired-or-unleased messages with SKIP LOCKED and bounds lease arguments', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database = databaseWith(calls)
    const repository = new WorkerRepository(database)
    await repository.claimOutbox('worker-a', 2, 15)
    assert.match(calls[0]?.text ?? '', /FOR UPDATE SKIP LOCKED/)
    assert.match(calls[0]?.text ?? '', /lease_expires_at IS NULL OR lease_expires_at <= now\(\)/)
    assert.deepEqual(calls[0]?.values, [ 2, 'worker-a', 15 ])
    await assert.rejects(() => repository.claimOutbox('worker-a', 101, 15), /limit/)
  })

  it('makes terminal mutations conditional on the current active lease', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database = databaseWith(calls)
    const repository = new WorkerRepository(database)
    assert.equal(await repository.markOutboxDelivered('message', 'worker-a'), false)
    assert.match(calls[0]?.text ?? '', /lease_owner = \$2 AND lease_expires_at > now\(\)/)
    assert.match(calls[0]?.text ?? '', /outbox_attempts/)
  })

  it('only renews the lease owned by the calling worker', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = new WorkerRepository(databaseWith(calls))
    assert.equal(await repository.renewJobLease('job', 'worker-a', 30), false)
    assert.match(calls[0]?.text ?? '', /lease_owner = \$2 AND lease_expires_at > now\(\)/)
    assert.deepEqual(calls[0]?.values, [ 'job', 'worker-a', 30 ])
  })

  it('claims lifecycle jobs with the same controlled lease contract', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database = databaseWith(calls)
    const repository = new WorkerRepository(database)
    await repository.claimJobs('worker-a', 1, 30)
    assert.match(calls[0]?.text ?? '', /status IN \('queued', 'running'\)/)
    assert.match(calls[0]?.text ?? '', /FOR UPDATE SKIP LOCKED/)
  })
})
