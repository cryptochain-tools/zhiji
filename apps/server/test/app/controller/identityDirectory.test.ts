import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import IdentityDirectoryController from '../../../app/controller/identityDirectory'
import { parseBusinessUserDirectoryRequest } from '../../../app/service/identity/directory'
import { DatabaseRuntime, DatabaseTransaction, QueryResult } from '../../../app/service/database/types'

describe('IdentityDirectoryController', () => {
  it('normalizes contact data and rejects event-like arbitrary fields', () => {
    const request = parseBusinessUserDirectoryRequest({
      key: 'zj_srv_active',
      profiles: [ { business_user_id: '42', email: 'USER@Example.COM', display_name: '张三', role: 'member', updated_at: '2026-09-13T01:02:03+00:00' } ],
    })
    assert.equal(request.profiles[0]?.email, 'user@example.com')
    assert.equal(request.profiles[0]?.updatedAt?.toISOString(), '2026-09-13T01:02:03.000Z')
    assert.throws(
      () => parseBusinessUserDirectoryRequest({ key: 'zj_srv_active', profiles: [ { business_user_id: '42', email: 'u@example.com', properties: { email: 'u@example.com' } } ] }),
      (error: Error & { code?: string }) => error.code === 'invalid_business_user_profiles',
    )
  })

  it('derives scope from the server key and upserts the dedicated directory', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const context = requestContext({ key: 'zj_srv_active', profiles: [ { business_user_id: '42', email: 'USER@example.com', is_active: true } ] })
    const controller = { ctx: context, app: { config: { zhiji: {
      database: runtime(calls),
      resolveServerIngestProject: async () => ({ tenantId: 'tenant-1', projectId: 'project-1', projectKeyId: 'key-1', pagePolicy: { allowedPageKeys: [], routeTemplates: [] } }),
    } } } }

    await (IdentityDirectoryController.prototype.upsert as unknown as Function).call(controller)

    assert.equal(context.status, 202)
    assert.deepEqual(context.body.data, { accepted: 1 })
    assert.match(calls[0]?.text ?? '', /INSERT INTO business_user_profiles/)
    assert.deepEqual(calls[0]?.values?.slice(0, 5), [ 'tenant-1', 'project-1', '42', 'user@example.com', null ])
  })

  it('does not count a profile rejected as stale by the database', async () => {
    const context = requestContext({ key: 'zj_srv_active', profiles: [ { business_user_id: '42', email: 'user@example.com', updated_at: '2025-01-01T00:00:00Z' } ] })
    const database = runtime([], 0)
    await (IdentityDirectoryController.prototype.upsert as unknown as Function).call({ ctx: context, app: { config: { zhiji: {
      database,
      resolveServerIngestProject: async () => ({ tenantId: 'tenant-1', projectId: 'project-1' }),
    } } } })
    assert.deepEqual(context.body.data, { accepted: 0 })
  })

  it('rejects browser origins and a body/header key mismatch', async () => {
    const originContext = requestContext({ key: 'zj_srv_active', profiles: [ { business_user_id: '42', email: 'u@example.com' } ] }, 'https://app.example')
    await assert.rejects(
      () => (IdentityDirectoryController.prototype.upsert as unknown as Function).call({ ctx: originContext, app: { config: { zhiji: {} } } }),
      (error: Error & { code?: string }) => error.code === 'identity_directory_origin_forbidden',
    )
    const mismatch = requestContext({ key: 'different', profiles: [ { business_user_id: '42', email: 'u@example.com' } ] })
    await assert.rejects(
      () => (IdentityDirectoryController.prototype.upsert as unknown as Function).call({ ctx: mismatch, app: { config: { zhiji: {} } } }),
      (error: Error & { code?: string }) => error.code === 'identity_directory_key_mismatch',
    )
  })
})

function requestContext(body: object, origin = '') {
  return {
    request: { body }, state: { requestId: 'request-1' }, status: 0,
    body: undefined as unknown as { data: { accepted: number } },
    get(name: string) {
      if (name === 'origin') return origin
      if (name === 'x-zhiji-key') return 'zj_srv_active'
      if (name === 'content-length') return '512'
      return ''
    },
  }
}

function runtime(calls: Array<{ text: string; values?: readonly unknown[] }>, rowCount = 1): DatabaseRuntime {
  const query = async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => { calls.push({ text, values }); return { rows: [], rowCount } }
  const database: DatabaseRuntime = {
    configured: true,
    query,
    async transaction<T>(run: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
      return run({ query, async commit() {}, async rollback() {} })
    },
    async checkReadiness() { return { connected: true, schemaVersion: 'test', expectedSchemaVersion: 'test', ready: true } },
    async close() {},
  }
  return database
}
