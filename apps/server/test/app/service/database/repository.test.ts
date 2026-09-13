import assert from 'node:assert/strict'
import { CoreDatabaseRepository } from '../../../../app/service/database/repository'
import { DatabaseClient } from '../../../../app/service/database/types'

describe('CoreDatabaseRepository', () => {
  it('uses lane in receipt conflict identity', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = {
      async query(text, values) {
        calls.push({ text, values })
        return { rows: [], rowCount: 0 }
      },
    }
    const repository = new CoreDatabaseRepository(database)

    const result = await repository.insertReceipt({
      tenantId: '1e44b545-99bd-4b5e-84c5-1c9673945be3',
      projectId: 'fd1c87f8-5e86-4bcf-b1fa-c7d48d470dc8',
      lane: 'analytics',
      clientEventId: 'af82170c-1b6b-41a7-aaf3-c4352baf88b3',
      decision: 'accepted',
    })

    assert.equal(result.inserted, false)
    assert.match(calls[0]?.text ?? '', /ON CONFLICT \(tenant_id, project_id, lane, client_event_id\)/)
    assert.deepEqual(calls[0]?.values?.slice(0, 4), [
      '1e44b545-99bd-4b5e-84c5-1c9673945be3',
      'fd1c87f8-5e86-4bcf-b1fa-c7d48d470dc8',
      'analytics',
      'af82170c-1b6b-41a7-aaf3-c4352baf88b3',
    ])
  })
})
