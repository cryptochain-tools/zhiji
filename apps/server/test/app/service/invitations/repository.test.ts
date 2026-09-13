import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { DatabasePool, DatabaseTransaction, QueryResult } from '../../../../app/service/database/types'
import { PostgresInvitationRepository } from '../../../../app/service/invitations/repository'

const tenantId = '30000000-0000-4000-8000-000000000001'
const actorId = '30000000-0000-4000-8000-000000000002'

class RecordingDatabase implements DatabasePool, DatabaseTransaction {
  calls: Array<{ text: string; values?: readonly unknown[] }> = []

  async query<Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
    this.calls.push({ text, values })
    if (text.includes('INSERT INTO invitations')) {
      return { rows: [{
        id: values?.[0], tenant_id: tenantId, email_normalized: 'new@example.com', role: 'member', invited_by_user_id: actorId,
        expires_at: new Date('2026-09-20T00:00:00.000Z'), accepted_at: null, revoked_at: null, created_at: new Date('2026-09-13T00:00:00.000Z'),
      } as Row], rowCount: 1 }
    }
    return { rows: [], rowCount: text.startsWith('SELECT') ? 0 : 1 }
  }

  async transaction<T>(run: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> { return run(this) }
  async commit(): Promise<void> {}
  async rollback(): Promise<void> {}
}

describe('PostgresInvitationRepository', () => {
  it('persists the request id in an eight-column audit insert', async () => {
    const database = new RecordingDatabase()
    await new PostgresInvitationRepository(database).create({
      scope: { tenantId, userId: actorId, role: 'owner' }, email: 'new@example.com', role: 'member', idempotencyKey: 'invite-1',
      tokenHash: Buffer.alloc(32), delivery: { sealed: 'opaque' }, expiresAt: new Date('2026-09-20T00:00:00.000Z'), requestId: 'request-1',
    })
    const audit = database.calls.find(call => call.text.includes('INSERT INTO audit_logs'))
    assert.match(audit?.text ?? '', /target_id, request_id, metadata/)
    assert.match(audit?.text ?? '', /VALUES \(\$1,\$2,\$3,\$4,'invitation',\$5,\$6,\$7::jsonb\)/)
    assert.equal(audit?.values?.[5], 'request-1')
  })
})
