import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { IngestCounts } from '../../../../app/contracts/ingest'
import { IngestDependencies, IngestTransportError, MobileIngestDependencies, ServerIngestDependencies, processIngest, processMobileIngest, processServerIngest } from '../../../../app/service/ingest/transport'

const now = new Date('2026-09-12T10:00:00.000Z')
const id = 'b2f35e73-0f73-4384-9e6f-08f9b4e4d2e5'
const project = {
  tenantId: 'tenant_1', projectId: 'project_1', projectKeyId: 'key_1', allowedOrigins: ['https://app.example.com'],
  pagePolicy: { allowedPageKeys: ['/pricing'], routeTemplates: ['/orders/:orderId'] },
  capture: { behavior: false, replay: false, performance: false, behaviorPolicy: { enabled: false, policyVersion: 1, pageAllowlist: [], trackIds: [], sampleRate: 1 } },
}
const counts: IngestCounts = { accepted: 1, duplicate: 0, sampled: 0, rate_limited: 0, dropped: 0 }
function eventBody(key = 'zj_pk') {
  return { key, events: [{ client_event_id: id, client_instance_id: '83f3992a-6a55-4704-a032-9e56c9e65713', client_sequence: 2, kind: 'event', name: 'page_view', visitor_id: 'visitor_a', occurred_at: now.toISOString(), route: '/orders/42' }] }
}
function dependencies(writer = true): IngestDependencies {
  return { now, resolveProject: async key => key === 'zj_pk' ? project : null, rateLimiter: { consume: async () => true }, ...(writer ? { writer: { write: async () => counts } } : {}) }
}
function serverDependencies(writer = true): ServerIngestDependencies {
  return {
    now, resolveProject: async key => key === 'zj_srv_key' ? { tenantId: project.tenantId, projectId: project.projectId, projectKeyId: project.projectKeyId, pagePolicy: project.pagePolicy } : null,
    rateLimiter: { consume: async () => true },
    ...(writer ? { writer: { write: async () => counts } } : {}),
  }
}
function mobileDependencies(writer = true): MobileIngestDependencies {
  return {
    now, resolveProject: async key => key === 'zj_mob_key' ? { tenantId: project.tenantId, projectId: project.projectId, projectKeyId: project.projectKeyId, pagePolicy: project.pagePolicy, applications: [{ platform: 'ios', applicationId: 'com.example.app', minVersion: '2.1.0', maxVersion: '3.0.0' }] } : null,
    rateLimiter: { consume: async () => true }, ...(writer ? { writer: { write: async () => counts } } : {}),
  }
}

describe('ingest transport', () => {
  it('authenticates a matching header/body key and delegates the scoped lane once', async () => {
    const calls: unknown[] = []
    const result = await processIngest({ lane: 'analytics', keyHeader: 'zj_pk', origin: 'https://app.example.com', body: eventBody() }, {
      ...dependencies(), writer: { write: async input => { calls.push(input); return counts } },
    })
    assert.deepEqual(result.counts, counts)
    assert.deepEqual(calls, [{ scope: { tenantId: 'tenant_1', projectId: 'project_1' }, lane: 'analytics', payload: { lane: 'analytics', key: 'zj_pk', events: [{ ...eventBody().events[0], route: '/orders/:orderId' }] }, clientEventIds: [id] }])
  })

  it('fails closed if a writer is not installed', async () => {
    await assert.rejects(() => processIngest({ lane: 'analytics', keyHeader: 'zj_pk', origin: 'https://app.example.com', body: eventBody() }, dependencies(false)), (error: unknown) => error instanceof IngestTransportError && error.status === 503 && error.code === 'ingest_unavailable')
  })

  it('enforces the lane/key/project limiter before the writer and fails closed when unavailable', async () => {
    let writes = 0
    const rejected = dependencies()
    rejected.rateLimiter = { consume: async input => {
      assert.deepEqual(input, { tenantId: project.tenantId, projectId: project.projectId, projectKeyId: project.projectKeyId, lane: 'analytics' })
      return false
    } }
    rejected.writer = { write: async () => { writes += 1; return counts } }
    await assert.rejects(() => processIngest({ lane: 'analytics', keyHeader: 'zj_pk', origin: 'https://app.example.com', body: eventBody() }, rejected),
      (error: unknown) => error instanceof IngestTransportError && error.status === 429 && error.code === 'rate_limited')
    assert.equal(writes, 0)

    const unavailable = dependencies()
    unavailable.rateLimiter = undefined
    await assert.rejects(() => processIngest({ lane: 'analytics', keyHeader: 'zj_pk', origin: 'https://app.example.com', body: eventBody() }, unavailable),
      (error: unknown) => error instanceof IngestTransportError && error.status === 503 && error.code === 'rate_limit_unavailable')
  })

  it('fails closed when the limiter database call fails', async () => {
    const unavailable = dependencies()
    unavailable.rateLimiter = { consume: async () => { throw new Error('database unavailable') } }
    await assert.rejects(() => processServerIngest({ lane: 'analytics', keyHeader: 'zj_srv_key', body: { ...eventBody('zj_srv_key') } }, { ...serverDependencies(), rateLimiter: unavailable.rateLimiter }),
      (error: unknown) => error instanceof IngestTransportError && error.status === 503 && error.code === 'rate_limit_unavailable')
  })

  it('rejects origin, missing header, mismatched keys, and cross-lane payload before writing', async () => {
    for (const request of [
      { lane: 'analytics' as const, keyHeader: '', origin: 'https://app.example.com', body: eventBody() },
      { lane: 'analytics' as const, keyHeader: 'zj_pk', origin: 'https://other.example.com', body: eventBody() },
      { lane: 'analytics' as const, keyHeader: 'zj_pk', origin: 'https://app.example.com', body: eventBody('other') },
      { lane: 'error' as const, keyHeader: 'zj_pk', origin: 'https://app.example.com', body: eventBody() },
    ]) {
      await assert.rejects(() => processIngest(request, dependencies()), IngestTransportError)
    }
  })

  it('returns the replay session id while counting chunks', async () => {
    const raw = JSON.stringify({ version: 1, events: [{ t: 'checkout', at: now.getTime(), route: '/pricing', viewport: { width: 1200, height: 800 } }] })
    const replay = { key: 'zj_pk', session: { replay_session_id: id, visitor_id: 'visitor_a', started_at: now.toISOString(), policy_version: 1, initial_route: '/pricing', sample_decision: true }, chunks: [{ chunk_id: '83f3992a-6a55-4704-a032-9e56c9e65713', sequence_start: 0, sequence_end: 0, encoding: 'rrweb-json' as const, data: Buffer.from(raw).toString('base64'), sha256: createHash('sha256').update(raw).digest('hex'), occurred_from: now.toISOString(), occurred_to: now.toISOString() }] }
    const result = await processIngest({ lane: 'replay', keyHeader: 'zj_pk', origin: 'https://app.example.com', body: replay }, { ...dependencies(), resolveProject: async () => ({ ...project, capture: { ...project.capture, replay: true } }) })
    assert.equal(result.sessionId, id)
  })

  it('rejects an optional collection lane when the server policy disables it', async () => {
    const body = { key: 'zj_pk', events: [{ client_event_id: id, kind: 'behavior', visitor_id: 'visitor_a', occurred_at: now.toISOString(), page_key: '/pricing', action: 'scroll_depth', depth_bucket: 25 }] }
    await assert.rejects(() => processIngest({ lane: 'behavior', keyHeader: 'zj_pk', origin: 'https://app.example.com', body }, dependencies()),
      (error: unknown) => error instanceof IngestTransportError && error.status === 403 && error.code === 'capture_disabled')
  })

  it('accepts Node SDK analytics without an Origin and uses the same strict writer contract', async () => {
    const calls: unknown[] = []
    const body = {
      key: 'zj_srv_key', events: [{ client_event_id: id, client_instance_id: '83f3992a-6a55-4704-a032-9e56c9e65713', client_sequence: 0, kind: 'event' as const, name: 'invoice.created', visitor_id: 'visitor_a', business_user_id: 'user_a', occurred_at: now.toISOString(), properties: { amount: 5 } }],
    }
    const result = await processServerIngest({ lane: 'analytics', keyHeader: 'zj_srv_key', body }, {
      ...serverDependencies(), writer: { write: async input => { calls.push(input); return counts } },
    })
    assert.deepEqual(result.counts, counts)
    assert.deepEqual(calls, [{ scope: { tenantId: project.tenantId, projectId: project.projectId }, lane: 'analytics', payload: { lane: 'analytics', ...body }, clientEventIds: [ id ] }])
  })

  it('rejects Origin-bearing traffic, browser-key resolution, mismatches, invalid payloads, and unavailable persistence', async () => {
    const serverEvent = { key: 'zj_srv_key', events: [{ client_event_id: id, client_instance_id: '83f3992a-6a55-4704-a032-9e56c9e65713', client_sequence: 0, kind: 'event', name: 'server.event', visitor_id: 'visitor_a', occurred_at: now.toISOString() }] }
    await assert.rejects(() => processServerIngest({ lane: 'analytics', keyHeader: 'zj_srv_key', origin: 'https://app.example.com', body: serverEvent }, serverDependencies()), (error: unknown) => error instanceof IngestTransportError && error.code === 'server_origin_forbidden')
    await assert.rejects(() => processServerIngest({ lane: 'analytics', keyHeader: 'zj_bro_key', body: { ...serverEvent, key: 'zj_bro_key' } }, serverDependencies()), (error: unknown) => error instanceof IngestTransportError && error.code === 'invalid_server_key')
    await assert.rejects(() => processServerIngest({ lane: 'analytics', keyHeader: 'zj_srv_key', body: { ...serverEvent, key: 'other' } }, serverDependencies()), (error: unknown) => error instanceof IngestTransportError && error.code === 'sdk_key_mismatch')
    await assert.rejects(() => processServerIngest({ lane: 'error', keyHeader: 'zj_srv_key', body: serverEvent }, serverDependencies()), (error: unknown) => error instanceof IngestTransportError && error.code === 'invalid_ingest_lane')
    await assert.rejects(() => processServerIngest({ lane: 'analytics', keyHeader: 'zj_srv_key', body: serverEvent }, serverDependencies(false)), (error: unknown) => error instanceof IngestTransportError && error.status === 503)
  })

  it('accepts the Node SDK error envelope while applying the error-specific stack bounds', async () => {
    const body = {
      key: 'zj_srv_key', events: [{ client_event_id: id, kind: 'error' as const, visitor_id: 'visitor_a', occurred_at: now.toISOString(), release: '2026.9.12', error: {
        mechanism: 'manual', type: 'DatabaseError', message: 'Request failed for user@example.com?token=secret', stack: `DatabaseError: failed\n${'x'.repeat(2_000)}`,
      } }],
    }
    const received: unknown[] = []
    await processServerIngest({ lane: 'error', keyHeader: 'zj_srv_key', body }, { ...serverDependencies(), writer: { write: async input => { received.push(input); return counts } } })
    const event = (received[0] as { payload: { events: Array<{ error: Record<string, unknown> }> } }).payload.events[0]!
    assert.equal(event.error.message, 'Request failed for [redacted-email]?token=[redacted]')
    assert.equal(typeof event.error.stack, 'string')
  })

  it('accepts only a registered mobile declaration and records its weak assurance label', async () => {
    const received: unknown[] = []
    const body = { key: 'zj_mob_key', events: [{ client_event_id: id, client_instance_id: '83f3992a-6a55-4704-a032-9e56c9e65713', client_sequence: 0, kind: 'event' as const, name: 'mobile.opened', visitor_id: 'visitor_a', occurred_at: now.toISOString() }] }
    await processMobileIngest({ lane: 'analytics', keyHeader: 'zj_mob_key', platformHeader: 'ios', applicationIdHeader: 'com.example.app', applicationVersionHeader: '2.3.1', body }, { ...mobileDependencies(), writer: { write: async input => { received.push(input); return counts } } })
    assert.deepEqual((received[0] as { mobileDeclaration: unknown }).mobileDeclaration, { platform: 'ios', applicationId: 'com.example.app', applicationVersion: '2.3.1', verificationLevel: 'declaration_only' })
  })

  it('rejects browser/server keys, undeclared apps, and versions outside mobile registration', async () => {
    const body = { key: 'zj_mob_key', events: [{ client_event_id: id, client_instance_id: '83f3992a-6a55-4704-a032-9e56c9e65713', client_sequence: 0, kind: 'event', name: 'mobile.opened', visitor_id: 'visitor_a', occurred_at: now.toISOString() }] }
    const request = { lane: 'analytics' as const, keyHeader: 'zj_mob_key', platformHeader: 'ios', applicationIdHeader: 'com.example.app', applicationVersionHeader: '2.3.1', body }
    await assert.rejects(() => processMobileIngest({ ...request, keyHeader: 'zj_bro_key', body: { ...body, key: 'zj_bro_key' } }, mobileDependencies()), (error: unknown) => error instanceof IngestTransportError && error.code === 'invalid_mobile_key')
    await assert.rejects(() => processMobileIngest({ ...request, applicationIdHeader: 'com.other.app' }, mobileDependencies()), (error: unknown) => error instanceof IngestTransportError && error.code === 'mobile_application_not_registered')
    await assert.rejects(() => processMobileIngest({ ...request, applicationVersionHeader: '3.1.0' }, mobileDependencies()), (error: unknown) => error instanceof IngestTransportError && error.code === 'mobile_version_not_allowed')
  })
})
