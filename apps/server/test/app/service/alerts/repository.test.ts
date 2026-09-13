import assert from 'node:assert/strict'
import { AlertsRepository } from '../../../../app/service/alerts/repository'
import { DatabaseClient } from '../../../../app/service/database/types'

function database(calls: Array<{ text: string; values?: readonly unknown[] }>): DatabaseClient { return { async query<Row extends object>(text: string, values?: readonly unknown[]) { calls.push({ text, values }); return { rows: [] as Row[], rowCount: 0 } } } }
describe('AlertsRepository', () => {
  it('uses a unique delivery and creates only a safe id-based worker payload', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = new AlertsRepository(database(calls))
    await repository.queueDelivery({ tenantId: 'tenant', projectId: 'project' }, 'instance', 'target')
    const query = calls[0]?.text ?? ''
    assert.match(query, /UNIQUE|ON CONFLICT \(alert_instance_id, target_id, payload_version\)/)
    assert.match(query, /notification_delivery_id/)
    assert.ok(!query.includes('webhook'))
  })
})
