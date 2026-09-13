import assert from 'node:assert/strict'
import { ErrorRepository } from '../../../../app/service/errors/repository'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'

describe('ErrorRepository', () => {
  it('scopes status updates and sends all values as parameters', async () => {
    const seen: Array<{ text: string; values: readonly unknown[] | undefined }> = []
    const db: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      seen.push({ text, values })
      return { rows: [{ group_id: 'group', status: 'resolved', resolved_at: new Date(), state_version: 8 } as Row], rowCount: 1 }
    } }
    const result = await new ErrorRepository(db).patchStatus({ tenantId: 'tenant', projectId: 'project' }, 'group', { status: 'resolved', expected_state_version: 7, reason: 'fixed' }, 'actor')
    assert.equal(result?.state_version, 8)
    assert.match(seen[0]!.text, /tenant_id = \$1 AND project_id = \$2 AND id = \$3 AND state_version = \$4/)
    assert.deepEqual(seen[0]!.values?.slice(0, 5), [ 'tenant', 'project', 'group', 7, 'resolved' ])
    assert.ok(!seen[0]!.text.includes("'tenant'"))
  })
})
