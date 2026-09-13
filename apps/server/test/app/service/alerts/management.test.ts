import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { AlertsManagementService } from '../../../../app/service/alerts'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'

const scope = { tenantId: '20000000-0000-4000-8000-000000000001', projectId: '20000000-0000-4000-8000-000000000002' }
const id = '20000000-0000-4000-8000-000000000003'
const created = new Date('2026-09-12T00:00:00.000Z')

describe('AlertsManagementService management lists', () => {
  it('projects notification targets without transport configuration and keeps scope', async () => {
    let call: { text: string; values?: readonly unknown[] } | undefined
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      call = { text, values }
      return { rows: [{ id, type: 'webhook', label: 'https://secret.example/hooks/abc', enabled: false, verified_at: null, created_at: created, updated_at: created, disabled_at: null, config_public: { url: 'https://secret.example' } } as Row], rowCount: 1 }
    } }
    const result = await new AlertsManagementService(database).listTargets(scope, { limit: '1' })
    assert.deepEqual(result.items, [{ id, type: 'webhook', label: 'webhook target', enabled: false, verified_at: null, created_at: created.toISOString(), updated_at: created.toISOString(), disabled_at: null }])
    assert.equal(result.next_cursor, null)
    assert.match(call!.text, /FROM notification_targets WHERE tenant_id=\$1 AND project_id=\$2/)
    assert.deepEqual(call!.values?.slice(0, 2), [ scope.tenantId, scope.projectId ])
    assert.doesNotMatch(JSON.stringify(result), /secret\.example|config_public/)
  })

  it('returns rule conditions and linked target ids through a scoped keyset query', async () => {
    let call: { text: string; values?: readonly unknown[] } | undefined
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      call = { text, values }
      return { rows: [{ id, name: 'Error count', enabled: true, rule_type: 'error_count', condition_json: { threshold: 3, window_seconds: 300 }, targets_version: 1, target_ids: [ '20000000-0000-4000-8000-000000000004' ], created_at: created, updated_at: created } as Row], rowCount: 1 }
    } }
    const result = await new AlertsManagementService(database).listRules(scope, { limit: '1' })
    assert.deepEqual(result.items[0], { id, name: 'Error count', enabled: true, rule_type: 'error_count', condition: { threshold: 3, window_seconds: 300 }, target_ids: [ '20000000-0000-4000-8000-000000000004' ], targets_version: 1, created_at: created.toISOString(), updated_at: created.toISOString() })
    assert.match(call!.text, /rule\.tenant_id=\$1 AND rule\.project_id=\$2/)
    assert.match(call!.text, /array_agg\(link\.target_id/)
    assert.deepEqual(call!.values?.slice(0, 2), [ scope.tenantId, scope.projectId ])
  })

  it('rejects invalid list query before querying persistence', async () => {
    let queried = false
    const database: DatabaseClient = { query: async <Row extends object>(): Promise<QueryResult<Row>> => { queried = true; return { rows: [], rowCount: 0 } } }
    await assert.rejects(new AlertsManagementService(database).listRules(scope, { limit: '1000' }), (error: Error & { code?: string }) => error.code === 'invalid_alert_query')
    assert.equal(queried, false)
  })
})

it('updates a rule only after validating its persisted type and all replacement targets', async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = []; let count = 0
  const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => { calls.push({ text, values }); count += 1; if (count === 1) return { rows: [{ id, name: 'Error count', enabled: true, rule_type: 'error_count', condition_json: { window_seconds: 300, threshold: 2 }, targets_version: 1, target_ids: [ '20000000-0000-4000-8000-000000000004' ], created_at: created, updated_at: created }] as Row[], rowCount: 1 }; if (count === 2) return { rows: [{ id }] as Row[], rowCount: 1 }; return { rows: [{ id, name: 'Edited', enabled: true, rule_type: 'error_count', condition_json: { window_seconds: 900, threshold: 4 }, targets_version: 2, target_ids: [ '20000000-0000-4000-8000-000000000004' ], created_at: created, updated_at: created }] as Row[], rowCount: 1 } } }
  const result = await new AlertsManagementService(database).updateRule(scope, id, '20000000-0000-4000-8000-000000000005', { expected_updated_at: created.toISOString(), name: 'Edited', condition: { window_seconds: 900, threshold: 4 } })
  assert.equal(result.name, 'Edited'); assert.match(calls[1]?.text ?? '', /valid_targets/); assert.match(calls[1]?.text ?? '', /date_trunc\('milliseconds',updated_at\)=\$8/); assert.match(calls[1]?.text ?? '', /INSERT INTO audit_logs/)
})

it('reads scoped alert instances and delivery outcomes without raw group keys, target endpoints, or unsafe errors', async () => {
  const queries: string[]=[]; let call=0
  const database: DatabaseClient={query:async<Row extends object>(text:string):Promise<QueryResult<Row>>=>{queries.push(text);call++;if(call===1)return{rows:[{id,rule_id:'20000000-0000-4000-8000-000000000004',rule_name:'Errors',rule_type:'error_count',group_key:'must-not-return',status:'active',first_triggered_at:created,last_triggered_at:created,last_evaluated_at:created,cooldown_until:created,payload_summary:{count:2,stack:'no'}} as Row],rowCount:1};return{rows:[{id,alert_instance_id:id,target_id:'20000000-0000-4000-8000-000000000004',target_type:'webhook',target_label:'https://secret.example',status:'failed',attempt_count:1,last_attempt_at:created,delivered_at:null,last_error_code:'notification_remote_rejected',created_at:created}] as Row[],rowCount:1}}}
  const service=new AlertsManagementService(database); const instances=await service.listInstances(scope,{limit:'1'});const deliveries=await service.listDeliveries(scope,{limit:'1'})
  assert.doesNotMatch(JSON.stringify(instances),/must-not-return|stack/);assert.doesNotMatch(JSON.stringify(deliveries),/secret\.example/);assert.equal(deliveries.items[0]?.error_code,'notification_remote_rejected');assert.match(queries[0]??'',/instance\.tenant_id=\$1/);assert.match(queries[1]??'',/delivery\.tenant_id=\$1/)
})
