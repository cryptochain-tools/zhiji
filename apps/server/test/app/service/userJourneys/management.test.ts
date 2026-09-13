import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { UserJourneysManagementService } from '../../../../app/service/userJourneys'
import { UserJourneysRepository } from '../../../../app/service/userJourneys/repository'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'

const scope = { tenantId: '10000000-0000-4000-8000-000000000001', projectId: '20000000-0000-4000-8000-000000000002' }
const profile = {
  business_user_id: '42', email_normalized: 'user@example.test', display_name: '测试用户', department: '业务部', role: 'regional_user', is_active: true,
  last_seen_at: new Date('2026-09-13T08:00:00Z'), event_count: '3',
}

describe('UserJourneysManagementService', () => {
  it('lists a scoped directory through verified identities in one aggregate query', async () => {
    let call: { text: string; values?: readonly unknown[] } | undefined
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      call = { text, values }
      return { rows: [profile as Row], rowCount: 1 }
    } }
    const result = await new UserJourneysManagementService(new UserJourneysRepository(database)).directory(scope, { search: '测试', limit: '25' })
    assert.equal(result.items[0]?.business_user_id, '42')
    assert.equal(result.items[0]?.event_count, 3)
    assert.match(call!.text, /WITH matching_profiles AS/)
    assert.match(call!.text, /JOIN identities identity/)
    assert.match(call!.text, /JOIN events event/)
    assert.doesNotMatch(call!.text, /LEFT JOIN LATERAL/)
    assert.doesNotMatch(call!.text, /event\.business_user_id/)
    assert.match(call!.text, /profile\.tenant_id = \$1 AND profile\.project_id = \$2/)
    assert.deepEqual(call!.values, [scope.tenantId, scope.projectId, '测试', 25])
  })

  it('returns a safe verified-identity journey and records the sensitive read', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      calls.push({ text, values })
      if (text.includes('FROM business_user_profiles profile')) return { rows: [profile as Row], rowCount: 1 }
      if (text.includes('FROM identities identity')) return { rows: [
        { occurred_at: new Date('2026-09-13T08:00:00Z'), name: 'page_view', route: '/bids/:bidId/', release: 'release-1' },
        { occurred_at: new Date('2026-09-13T07:59:00Z'), name: 'acme.workspace.export.attempt', route: null, release: 'release-1' },
      ] as Row[], rowCount: 2 }
      return { rows: [], rowCount: 1 }
    } }
    const result = await new UserJourneysManagementService(new UserJourneysRepository(database)).show(
      scope, '42', { from: '2026-09-01T00:00:00Z', to: '2026-09-13T09:00:00Z', limit: '100' },
      '30000000-0000-4000-8000-000000000003', 'request-1', new Date('2026-09-13T09:01:00Z'),
    )
    assert.deepEqual(result.items.map(item => ({ kind: item.kind, name: item.name, route: item.route })), [
      { kind: 'page', name: 'page_view', route: '/bids/:bidId/' },
      { kind: 'action', name: 'acme.workspace.export.attempt', route: null },
    ])
    assert.equal(result.has_more, false)
    assert.equal(calls.length, 3)
    assert.match(calls[1]!.text, /FROM identities identity/)
    assert.match(calls[1]!.text, /identity\.tenant_id = \$1 AND identity\.project_id = \$2 AND identity\.business_user_id = \$3/)
    assert.doesNotMatch(calls[1]!.text, /event\.business_user_id/)
    assert.doesNotMatch(calls[1]!.text, /properties/)
    assert.match(calls[2]!.text, /business_user_journey_viewed/)
    assert.equal(calls[2]!.values?.[3], '42')
    assert.equal(calls[2]!.values?.[4], 'request-1')
  })

  it('rejects unbounded ranges and invalid limits before querying', async () => {
    let called = false
    const database: DatabaseClient = { query: async <Row extends object>(): Promise<QueryResult<Row>> => { called = true; return { rows: [], rowCount: 0 } } }
    await assert.rejects(
      new UserJourneysManagementService(new UserJourneysRepository(database)).show(scope, '42', { from: '2026-01-01T00:00:00Z', to: '2026-09-13T00:00:00Z', limit: '100' }, 'actor', undefined, new Date('2026-09-13T00:00:00Z')),
      { code: 'invalid_user_journey_query' },
    )
    assert.equal(called, false)
    await assert.rejects(
      new UserJourneysManagementService(new UserJourneysRepository(database)).show(scope, '', { from: '2026-09-01T00:00:00Z', to: '2026-09-13T00:00:00Z', limit: '100' }, 'actor', undefined, new Date('2026-09-13T00:00:00Z')),
      { code: 'invalid_user_journey_query' },
    )
    assert.equal(called, false)
  })

  it('defaults a missing time range to the last 30 days', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      calls.push({ text, values })
      if (text.includes('FROM business_user_profiles profile')) return { rows: [profile as Row], rowCount: 1 }
      if (text.includes('FROM identities identity')) return { rows: [], rowCount: 0 }
      return { rows: [], rowCount: 1 }
    } }
    const now = new Date('2026-09-13T09:00:00Z')
    const result = await new UserJourneysManagementService(new UserJourneysRepository(database)).show(scope, '42', {}, 'actor', undefined, now)
    assert.equal(result.from, '2026-08-14T09:00:00.000Z')
    assert.equal(result.to, '2026-09-13T09:00:00.000Z')
    assert.deepEqual(calls[1]?.values?.slice(0, 5), [scope.tenantId, scope.projectId, '42', new Date('2026-08-14T09:00:00.000Z'), now])
  })

  it('keeps a missing business user in another scope indistinguishable from an absent profile', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      calls.push({ text, values })
      return { rows: [], rowCount: 0 }
    } }
    await assert.rejects(
      new UserJourneysManagementService(new UserJourneysRepository(database)).show(scope, 'only-in-another-project', {}, 'actor', undefined, new Date('2026-09-13T09:00:00Z')),
      { code: 'business_user_not_found' },
    )
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0]?.values, [scope.tenantId, scope.projectId, 'only-in-another-project'])
  })

  it('adds the inverse verified-identity index used by the journey SQL', () => {
    const migration = readFileSync(resolve(process.cwd(), 'migrations/037_user_journey_identity_index.sql'), 'utf8')
    assert.match(migration, /CREATE INDEX identities_project_business_visitor_idx/)
    assert.match(migration, /identities \(tenant_id, project_id, business_user_id, visitor_id\)/)
  })
})
