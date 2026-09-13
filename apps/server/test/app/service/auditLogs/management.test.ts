import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { AuditLogManagementService } from '../../../../app/service/auditLogs'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'

const scope = { tenantId: '20000000-0000-4000-8000-000000000001' }
const firstId = '20000000-0000-4000-8000-000000000002'
const secondId = '20000000-0000-4000-8000-000000000003'

describe('AuditLogManagementService', () => {
  it('uses a tenant-scoped, bounded cursor query and never selects metadata', async () => {
    let call: { text: string; values?: readonly unknown[] } | undefined
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      call = { text, values }
      return { rows: [
        { id: firstId, action: 'project_key_disabled', target_type: 'project_key', target_id: 'key_a', actor_user_id: null, created_at: new Date('2026-09-12T01:00:00Z'), metadata: { password: 'must-not-leak' } },
        { id: secondId, action: 'project_key_disabled', target_type: 'project_key', target_id: 'key_b', actor_user_id: '20000000-0000-4000-8000-000000000004', created_at: new Date('2026-09-12T00:00:00Z'), metadata: { old_value: 'must-not-leak' } },
      ] as Row[], rowCount: 2 }
    } }
    const result = await new AuditLogManagementService(database).list(scope, { from: '2026-09-11T00:00:00Z', to: '2026-09-12T02:00:00Z', action: 'project_key_disabled', target_type: 'project_key', limit: '1' }, new Date('2026-09-12T03:00:00Z'))
    assert.equal(result.items.length, 1)
    assert.deepEqual(result.items[0], { id: firstId, action: 'project_key_disabled', target_type: 'project_key', target_id: 'key_a', actor_user_id: null, created_at: '2026-09-12T01:00:00.000Z' })
    assert.ok(result.next_cursor)
    assert.match(call!.text, /SELECT id, action, target_type, target_id, actor_user_id, created_at/)
    assert.doesNotMatch(call!.text, /metadata|request_id/i)
    assert.match(call!.text, /tenant_id = \$1/)
    assert.match(call!.text, /created_at >= \$2/)
    assert.match(call!.text, /ORDER BY created_at DESC, id DESC LIMIT \$6/)
    assert.deepEqual(call!.values?.slice(0, 5), [ scope.tenantId, new Date('2026-09-11T00:00:00Z'), new Date('2026-09-12T02:00:00Z'), 'project_key_disabled', 'project_key' ])
    assert.equal(call!.values?.[5], 2)
  })

  it('rejects unbounded ranges, free-form actor searches, and malformed cursors before querying', async () => {
    let queried = false
    const database: DatabaseClient = { query: async <Row extends object>(): Promise<QueryResult<Row>> => { queried = true; return { rows: [], rowCount: 0 } } }
    const service = new AuditLogManagementService(database)
    await assert.rejects(service.list(scope, { from: '2026-01-01T00:00:00Z', to: '2026-09-12T00:00:00Z' }, new Date('2026-09-12T00:00:00Z')), (error: Error & { code?: string }) => error.code === 'invalid_audit_log_query')
    await assert.rejects(service.list(scope, { cursor: 'not-a-cursor' }), (error: Error & { code?: string }) => error.code === 'invalid_audit_log_cursor')
    await assert.rejects(service.list(scope, { actor: 'someone@example.test' }, new Date('2026-09-12T00:00:00Z')), (error: Error & { code?: string }) => error.code === 'invalid_audit_log_query')
    assert.equal(queried, false)
  })
})
