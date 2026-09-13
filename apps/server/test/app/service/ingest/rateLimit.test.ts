import assert from 'node:assert/strict'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'
import { INGEST_REQUESTS_PER_MINUTE, PostgreSqlIngestRateLimiter } from '../../../../app/service/ingest/rateLimit'

describe('PostgreSqlIngestRateLimiter', () => {
  it('uses one atomic, bounded bucket per tenant/project/key/lane', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = {
      async query<Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
        calls.push({ text, values })
        return { rows: [{ request_count: 1 } as Row], rowCount: 1 }
      },
    }
    const limiter = new PostgreSqlIngestRateLimiter(database)
    assert.equal(await limiter.consume({ tenantId: 'tenant_1', projectId: 'project_1', projectKeyId: 'key_1', lane: 'replay' }), true)
    assert.equal(await limiter.consume({ tenantId: 'tenant_1', projectId: 'project_1', projectKeyId: 'key_2', lane: 'analytics' }), true)
    assert.match(calls[0]!.text, /INSERT INTO ingest_rate_limit_buckets/)
    assert.match(calls[0]!.text, /ON CONFLICT \(tenant_id, project_id, project_key_id, lane\) DO UPDATE/)
    assert.match(calls[0]!.text, /request_count < \$5/)
    assert.deepEqual(calls[0]!.values, [ 'tenant_1', 'project_1', 'key_1', 'replay', INGEST_REQUESTS_PER_MINUTE.replay ])
    assert.deepEqual(calls[1]!.values, [ 'tenant_1', 'project_1', 'key_2', 'analytics', INGEST_REQUESTS_PER_MINUTE.analytics ])
  })

  it('returns false when PostgreSQL declined the increment at the fixed-window limit', async () => {
    const database: DatabaseClient = { async query<Row extends object>(): Promise<QueryResult<Row>> { return { rows: [], rowCount: 0 } } }
    assert.equal(await new PostgreSqlIngestRateLimiter(database).consume({ tenantId: 'tenant_1', projectId: 'project_1', projectKeyId: 'key_1', lane: 'analytics' }), false)
  })

  it('does not allow an invalid configured lane limit', async () => {
    const database: DatabaseClient = { async query<Row extends object>(): Promise<QueryResult<Row>> { throw new Error('must not query') } }
    const limits = { ...INGEST_REQUESTS_PER_MINUTE, error: 0 }
    await assert.rejects(() => new PostgreSqlIngestRateLimiter(database, limits).consume({ tenantId: 'tenant_1', projectId: 'project_1', projectKeyId: 'key_1', lane: 'error' }), /rate limit is invalid/)
  })
})
