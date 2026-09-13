import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { ErrorManagementService } from '../../../../app/service/errors'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'

const scope = { tenantId: '20000000-0000-4000-8000-000000000001', projectId: '20000000-0000-4000-8000-000000000002' }
const groupId = '20000000-0000-4000-8000-000000000003'

describe('ErrorManagementService', () => {
  it('returns the scoped current snapshot when optimistic status update conflicts', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      seen.push({ text, values })
      if (text.includes('WITH prior AS')) return { rows: [], rowCount: 0 }
      return { rows: [{ group_id: groupId, status: 'ignored', resolved_at: null, state_version: 8 } as Row], rowCount: 1 }
    } }
    await assert.rejects(
      new ErrorManagementService(database).patchStatus(scope, groupId, { status: 'resolved', expected_state_version: 7 }, '20000000-0000-4000-8000-000000000004'),
      (error: Error & { code?: string; current?: { state_version?: number } }) => error.code === 'error_state_version_conflict' && error.current?.state_version === 8,
    )
    assert.match(seen[0]!.text, /tenant_id = \$1 AND project_id = \$2 AND id = \$3 AND state_version = \$4/)
    assert.deepEqual(seen[0]!.values?.slice(0, 4), [ scope.tenantId, scope.projectId, groupId, 7 ])
    assert.match(seen[1]!.text, /tenant_id = \$1 AND project_id = \$2 AND id = \$3/)
  })

  it('rejects invalid date ranges and invalid cursors before querying', async () => {
    let queried = false
    const database: DatabaseClient = { query: async <Row extends object>(): Promise<QueryResult<Row>> => { queried = true; return { rows: [], rowCount: 0 } } }
    const service = new ErrorManagementService(database)
    await assert.rejects(service.list(scope, { from: '2026-01-01T00:00:00Z', to: '2026-05-01T00:00:00Z' }, new Date('2026-05-01T00:00:00Z')), (error: Error & { code?: string }) => error.code === 'invalid_error_query')
    await assert.rejects(service.list(scope, { cursor: 'bad' }), (error: Error & { code?: string }) => error.code === 'invalid_error_cursor')
    assert.equal(queried, false)
  })
})
