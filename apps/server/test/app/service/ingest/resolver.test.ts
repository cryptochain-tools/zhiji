import assert from 'node:assert/strict'
import { BrowserProjectKeyResolver, MobileProjectKeyResolver, OtlpProjectKeyResolver, ServerProjectKeyResolver } from '../../../../app/service/ingest/resolver'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'

describe('BrowserProjectKeyResolver', () => {
  it('resolves only a browser key and fails closed for an invalid persisted policy', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const row = {
      project_key_id: '00000000-0000-4000-8000-000000000003', tenant_id: '00000000-0000-4000-8000-000000000001', project_id: '00000000-0000-4000-8000-000000000002',
      allowed_origins: [ 'https://app.example.com' ], page_capture: { allowed_page_keys: [ '/pricing' ], route_templates: [ '/orders/:id' ] },
      behavior_capture: { enabled: true, policy_version: 1, page_allowlist: [ '/pricing' ], track_ids: [ 'save_button' ], block_selectors: [], sample_rate: 1 }, session_replay: { enabled: false, policy_version: 1 }, performance_capture: { enabled: true, policy_version: 1 },
    }
    const db: DatabaseClient = { async query<Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> { calls.push({ text, values }); return { rows: [ row as Row ], rowCount: 1 } } }
    const resolved = await new BrowserProjectKeyResolver(db).resolve('zj_bro_secret-value')
    assert.deepEqual(resolved, {
      tenantId: row.tenant_id, projectId: row.project_id, projectKeyId: row.project_key_id, allowedOrigins: row.allowed_origins,
      pagePolicy: { allowedPageKeys: [ '/pricing' ], routeTemplates: [ '/orders/:id' ] },
      capture: { behavior: true, replay: false, performance: true, behaviorPolicy: { enabled: true, policyVersion: 1, pageAllowlist: [ '/pricing' ], trackIds: [ 'save_button' ], sampleRate: 1 } },
    })
    assert.match(calls[0]!.text, /keys\.key_type = 'browser' AND keys\.disabled_at IS NULL/)
    assert.ok(Buffer.isBuffer(calls[0]!.values?.[0]))

    const invalid: DatabaseClient = { async query<Row extends object>(): Promise<QueryResult<Row>> { return { rows: [{ ...row, page_capture: { allowed_page_keys: 'wrong', route_templates: [] } } as Row], rowCount: 1 } } }
    assert.equal(await new BrowserProjectKeyResolver(invalid).resolve('zj_bro_secret-value'), null)
  })
})

describe('ServerProjectKeyResolver', () => {
  it('resolves only an active server key and fails closed for invalid page policy', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const row = {
      project_key_id: '00000000-0000-4000-8000-000000000003', tenant_id: '00000000-0000-4000-8000-000000000001', project_id: '00000000-0000-4000-8000-000000000002',
      page_capture: { allowed_page_keys: [ '/pricing' ], route_templates: [ '/orders/:id' ] },
    }
    const db: DatabaseClient = { async query<Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> { calls.push({ text, values }); return { rows: [ row as Row ], rowCount: 1 } } }
    assert.deepEqual(await new ServerProjectKeyResolver(db).resolve('zj_srv_secret-value'), {
      tenantId: row.tenant_id, projectId: row.project_id, projectKeyId: row.project_key_id, pagePolicy: { allowedPageKeys: [ '/pricing' ], routeTemplates: [ '/orders/:id' ] },
    })
    assert.match(calls[0]!.text, /keys\.key_type = 'server' AND keys\.disabled_at IS NULL/)
    assert.ok(Buffer.isBuffer(calls[0]!.values?.[0]))

    const invalid: DatabaseClient = { async query<Row extends object>(): Promise<QueryResult<Row>> { return { rows: [{ ...row, page_capture: { allowed_page_keys: [], route_templates: 'wrong' } } as Row], rowCount: 1 } } }
    assert.equal(await new ServerProjectKeyResolver(invalid).resolve('zj_srv_secret-value'), null)
  })
})

describe('OtlpProjectKeyResolver', () => {
  it('resolves only an active dedicated otel key', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const row = { project_key_id: '00000000-0000-4000-8000-000000000003', tenant_id: '00000000-0000-4000-8000-000000000001', project_id: '00000000-0000-4000-8000-000000000002', page_capture: { allowed_page_keys: [], route_templates: [] } }
    const db: DatabaseClient = { async query<Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> { calls.push({ text, values }); return { rows: [row as Row], rowCount: 1 } } }
    assert.deepEqual(await new OtlpProjectKeyResolver(db).resolve('zj_ote_secret-value'), { tenantId: row.tenant_id, projectId: row.project_id, projectKeyId: row.project_key_id, pagePolicy: { allowedPageKeys: [], routeTemplates: [] } })
    assert.match(calls[0]!.text, /keys\.key_type = 'otel' AND keys\.disabled_at IS NULL/)
    assert.ok(Buffer.isBuffer(calls[0]!.values?.[0]))
  })
})

describe('MobileProjectKeyResolver', () => {
  it('resolves only active mobile keys with valid registrations', async () => {
    const calls: Array<{ text: string }> = []
    const row = { project_key_id: '00000000-0000-4000-8000-000000000003', tenant_id: '00000000-0000-4000-8000-000000000001', project_id: '00000000-0000-4000-8000-000000000002', page_capture: { allowed_page_keys: [], route_templates: [] }, mobile_applications: [{ platform: 'android', application_id: 'com.example.app', min_version: '1.0.0', max_version: '2.0.0' }] }
    const db: DatabaseClient = { async query<Row extends object>(text: string): Promise<QueryResult<Row>> { calls.push({ text }); return { rows: [ row as Row ], rowCount: 1 } } }
    assert.deepEqual(await new MobileProjectKeyResolver(db).resolve('zj_mob_secret-value'), { tenantId: row.tenant_id, projectId: row.project_id, projectKeyId: row.project_key_id, pagePolicy: { allowedPageKeys: [], routeTemplates: [] }, applications: [{ platform: 'android', applicationId: 'com.example.app', minVersion: '1.0.0', maxVersion: '2.0.0' }] })
    assert.match(calls[0]!.text, /keys\.key_type = 'mobile' AND keys\.disabled_at IS NULL/)
  })
})
