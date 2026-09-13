import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { consumeIdentityAssertion, mintIdentityAssertion } from '../../../../app/service/identity/assertions'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'

describe('identity assertions', () => {
  it('mints only a hashed opaque value with a bounded expiry', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const now = new Date('2026-09-12T00:00:00.000Z')
    const issued = await mintIdentityAssertion(database(calls), scope, now)
    assert.match(issued.assertion, /^zj_ia_[A-Za-z0-9_-]{40,}$/)
    assert.equal(issued.expiresAt.toISOString(), '2026-09-12T00:05:00.000Z')
    assert.match(calls[0]?.text ?? '', /INSERT INTO identity_assertions/)
    assert.ok(Buffer.isBuffer(calls[0]?.values?.[1]))
    assert.notEqual(calls[0]?.values?.[1]?.toString(), issued.assertion)
  })

  it('consumes only a scope-bound unexpired credential once', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const accepted = await consumeIdentityAssertion(database(calls, 1), { ...scope, assertion: 'zj_ia_test-assertion-with-sufficient-length' }, new Date())
    assert.equal(accepted, true)
    assert.match(calls[0]?.text ?? '', /consumed_at IS NULL AND expires_at > \$6/)
    assert.equal(calls[0]?.values?.[1], scope.tenantId)
    assert.equal(calls[0]?.values?.[4], scope.businessUserId)
    assert.equal(await consumeIdentityAssertion(database([], 0), { ...scope, assertion: 'zj_ia_test-assertion-with-sufficient-length' }), false)
  })
})

const scope = { tenantId: '20000000-0000-4000-8000-000000000001', projectId: '20000000-0000-4000-8000-000000000002', visitorId: 'visitor_a', businessUserId: 'user_a' }
function database(calls: Array<{ text: string; values?: readonly unknown[] }>, rowCount = 1): DatabaseClient {
  return { async query<Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> { calls.push({ text, values }); return { rows: [], rowCount } } }
}
