import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import IdentityAssertionsController, { parseIdentityAssertionRequest } from '../../../app/controller/identityAssertions'
import { DatabaseRuntime, QueryResult } from '../../../app/service/database/types'

describe('IdentityAssertionsController request contract', () => {
  it('accepts only the visitor and business-user identifiers required for a scoped assertion', () => {
    assert.deepEqual(parseIdentityAssertionRequest({ visitor_id: 'visitor-1', business_user_id: 'user-1' }), {
      visitorId: 'visitor-1', businessUserId: 'user-1',
    })
  })

  for (const body of [ null, [], { visitor_id: 'visitor-1' }, { visitor_id: ' visitor-1', business_user_id: 'user-1' }, { visitor_id: 'visitor-1', business_user_id: 'user-1', tenant_id: 'attacker-controlled' } ]) {
    it(`rejects invalid request body ${JSON.stringify(body)}`, () => {
      assert.throws(() => parseIdentityAssertionRequest(body), (error: Error & { code?: string }) => error.code === 'invalid_identity_assertion_request')
    })
  }

  it('derives tenant and project only from an active server key and prevents caching the plaintext assertion', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const context = requestContext({ visitor_id: 'visitor-1', business_user_id: 'user-1' })
    const database = runtime(calls)
    const controller = {
      ctx: context,
      app: { config: { zhiji: {
        database,
        resolveServerIngestProject: async (key: string) => key === 'zj_srv_active' ? {
          tenantId: '20000000-0000-4000-8000-000000000001', projectId: '20000000-0000-4000-8000-000000000002', projectKeyId: '20000000-0000-4000-8000-000000000003', pagePolicy: { allowedPageKeys: [], routeTemplates: [] },
        } : null,
      } } },
    }
    await (IdentityAssertionsController.prototype.create as unknown as Function).call(controller)
    assert.equal(context.status, 201)
    assert.match(context.body.data.assertion, /^zj_ia_/)
    assert.match(context.body.data.expires_at, /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(context.headers.get('Cache-Control'), 'no-store')
    assert.equal(context.headers.get('Pragma'), 'no-cache')
    assert.match(calls[0]?.text ?? '', /INSERT INTO identity_assertions/)
    assert.deepEqual(calls[0]?.values?.slice(2, 6), [ '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'visitor-1', 'user-1' ])
  })

  it('rejects Origin-bearing requests before resolving a server key', async () => {
    let resolved = false
    const context = requestContext({ visitor_id: 'visitor-1', business_user_id: 'user-1' }, 'https://app.example.test')
    const controller = { ctx: context, app: { config: { zhiji: { database: runtime([]), resolveServerIngestProject: async () => { resolved = true; return null } } } } }
    await assert.rejects(
      () => (IdentityAssertionsController.prototype.create as unknown as Function).call(controller),
      (error: Error & { code?: string }) => error.code === 'identity_assertion_origin_forbidden',
    )
    assert.equal(resolved, false)
  })
})

function requestContext(body: object, origin = '') {
  const headers = new Map<string, string>()
  return {
    request: { body }, state: { requestId: 'request-1' }, headers, status: 0, body: undefined as unknown as { data: { assertion: string; expires_at: string } },
    get(name: string) { return name === 'origin' ? origin : name === 'x-zhiji-key' ? 'zj_srv_active' : '' },
    set(name: string, value: string) { headers.set(name, value) },
  }
}

function runtime(calls: Array<{ text: string; values?: readonly unknown[] }>): DatabaseRuntime {
  return {
    configured: true,
    async query<Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> { calls.push({ text, values }); return { rows: [], rowCount: 1 } },
    async transaction<T>(run: never): Promise<T> { return run as T },
    async checkReadiness() { return { connected: true, schemaVersion: 'test', expectedSchemaVersion: 'test', ready: true } },
    async close() {},
  }
}
