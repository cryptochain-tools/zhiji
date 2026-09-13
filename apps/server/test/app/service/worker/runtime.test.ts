import assert from 'node:assert/strict'
import { WorkerRepository } from '../../../../app/service/worker/repository'
import { TerminalOutboxDeliveryError, WorkerRuntime } from '../../../../app/service/worker/runtime'
import { WorkerRepositoryDatabase } from '../../../../app/service/worker/types'

function countingDatabase(onQuery: () => void): WorkerRepositoryDatabase {
  return {
    async query<Row extends object>() {
      onQuery()
      return { rows: [] as Row[], rowCount: 0 }
    },
  }
}

describe('WorkerRuntime', () => {
  it('does not poll before explicit start or pollOnce', async () => {
    let calls = 0
    const database = countingDatabase(() => { calls += 1 })
    const runtime = new WorkerRuntime(new WorkerRepository(database), {
      async deliverOutbox() {},
      async runJob() { return { processedCount: 0, failedCount: 0 } },
    }, { workerId: 'test-worker' })

    assert.equal(calls, 0)
    await runtime.pollOnce()
    assert.equal(calls, 2)
    await runtime.stop()
  })

  it('discards terminal delivery failures without a retry', async () => {
    const discarded: unknown[][] = []
    const repository = {
      async claimOutbox() { return [{ id: 'outbox-1', tenant_id: 'tenant', project_id: 'project', topic: 'invitation_email', idempotency_key: 'key', payload: {}, available_at: new Date(), lease_owner: 'worker', lease_expires_at: new Date(), attempt_count: 1, max_attempts: 5 }] },
      async claimJobs() { return [] },
      async markOutboxDelivered() { throw new Error('should_not_deliver') },
      async retryOutbox() { throw new Error('should_not_retry') },
      async discardOutbox(...args: unknown[]) { discarded.push(args) },
    }
    const runtime = new WorkerRuntime(repository as unknown as WorkerRepository, {
      async deliverOutbox() { throw new TerminalOutboxDeliveryError('invitation_delivery_unavailable') },
      async runJob() { return { processedCount: 0, failedCount: 0 } },
    }, { workerId: 'worker' })

    await runtime.pollOnce()
    assert.deepEqual(discarded, [[ 'outbox-1', 'worker', 'invitation_delivery_unavailable' ]])
  })
})
