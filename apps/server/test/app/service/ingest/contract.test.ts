import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { claimReceipts, IngestContractError, sanitizePageKey, validateIngest } from '../../../../app/service/ingest'
import { IngestLane, ReceiptKey, ReceiptStore } from '../../../../app/contracts/ingest'

const now = new Date('2026-09-12T10:00:00.000Z')
const options = { now, pagePolicy: { allowedPageKeys: ['/pricing'], routeTemplates: ['/orders/:orderId'] } }
const id = 'b2f35e73-0f73-4384-9e6f-08f9b4e4d2e5'

describe('ingest contract', () => {
  it('normalizes only configured stable page keys', () => {
    assert.equal(sanitizePageKey('/orders/123', options.pagePolicy), '/orders/:orderId')
    assert.equal(sanitizePageKey('/orders/123?email=a@example.com', options.pagePolicy), null)
    assert.equal(sanitizePageKey('/unknown/123', options.pagePolicy), null)
  })

  it('rejects cross-lane payloads before any receipt can be claimed', () => {
    assert.throws(() => validateIngest('behavior', { key: 'zj_pk', events: [{ client_event_id: id, kind: 'event' }] }, options), (error: unknown) => error instanceof IngestContractError && error.code === 'invalid_ingest_lane')
  })

  it('accepts an analytics event with bounded and sanitized fields', () => {
    const result = validateIngest('analytics', { key: 'zj_pk', events: [{ client_event_id: id, client_instance_id: '83f3992a-6a55-4704-a032-9e56c9e65713', client_sequence: 2, kind: 'event', name: 'page_view', visitor_id: 'visitor_a', occurred_at: now.toISOString(), url: '/orders/42', route: '/orders/42', properties: { plan: 'pro' } }] }, options)
    assert.equal(result.lane, 'analytics')
    if (result.lane === 'analytics') {
      const event = result.events[0]
      assert.ok(event && event.kind === 'event')
      assert.deepEqual(event.route, '/orders/:orderId')
    }
  })

  it('rejects sensitive free-form properties and unverified login wire expansion', () => {
    assert.throws(() => validateIngest('analytics', { key: 'zj_pk', events: [{ client_event_id: id, client_instance_id: '83f3992a-6a55-4704-a032-9e56c9e65713', client_sequence: 2, kind: 'event', name: 'x', visitor_id: 'visitor_a', occurred_at: now.toISOString(), properties: { email: 'a@example.com' } }] }, options), IngestContractError)
    assert.throws(() => validateIngest('analytics', { key: 'zj_pk', events: [{ client_event_id: id, client_instance_id: '83f3992a-6a55-4704-a032-9e56c9e65713', client_sequence: 2, kind: 'login', visitor_id: 'visitor_a', business_user_id: 'user_a', identity_assertion: 'opaque', occurred_at: now.toISOString(), name: 'login' }] }, options), IngestContractError)
  })

  it('accepts only a closed behavior shape and never accepts a client element hash', () => {
    const event = { client_event_id: id, kind: 'behavior', visitor_id: 'visitor_a', occurred_at: now.toISOString(), page_key: '/pricing', action: 'autocapture_change', element_token: 'save_button', control_type: 'input' }
    const result = validateIngest('behavior', { key: 'zj_pk', events: [event] }, options)
    if (result.lane !== 'behavior') throw new Error('expected behavior')
    assert.equal(result.events[0]?.element_token, 'save_button')
    assert.throws(() => validateIngest('behavior', { key: 'zj_pk', events: [{ ...event, element_key: 'client-hash' }] }, options), IngestContractError)
    assert.throws(() => validateIngest('behavior', { key: 'zj_pk', events: [{ ...event, control_type: undefined }] }, options), IngestContractError)
  })

  it('accepts bounded error stacks only in the closed error shape', () => {
    const body = { key: 'zj_pk', events: [{ client_event_id: id, kind: 'error', visitor_id: 'visitor_a', occurred_at: now.toISOString(), error: { mechanism: 'manual', type: 'Error', message: 'contact user@example.com', stack: 'Error: token=secret' } }] }
    const errorEvent = body.events[0]!
    const result = validateIngest('error', body, options)
    assert.equal(result.lane, 'error')
    if (result.lane === 'error') assert.equal(result.events[0]?.error.message, 'contact [redacted-email]')
    assert.throws(() => validateIngest('error', { ...body, events: [{ ...errorEvent, error: { ...errorEvent.error, context: {} } }] }, options), IngestContractError)
    assert.throws(() => validateIngest('error', { ...body, events: [{ ...errorEvent, error: { ...errorEvent.error, stack: 'x'.repeat(12 * 1024 + 1) } }] }, options), IngestContractError)
  })

  it('accepts only privacy-preserving behavior facts with complete coordinates', () => {
    const result = validateIngest('behavior', { key: 'zj_pk', events: [{
      client_event_id: id, kind: 'behavior', visitor_id: 'visitor_a', occurred_at: now.toISOString(), page_key: '/pricing',
      action: 'rage_click', viewport_width: 1280, viewport_height: 800, document_width: 1280, document_height: 2400,
      client_x: 400, client_y: 300, document_x: 400, document_y: 1700, click_count: 3, element_token: 'save_button',
    }] }, options)
    assert.equal(result.lane, 'behavior')
    assert.throws(() => validateIngest('behavior', { key: 'zj_pk', events: [{
      client_event_id: id, kind: 'behavior', visitor_id: 'visitor_a', occurred_at: now.toISOString(), page_key: '/pricing', action: 'autocapture_click', element_key: 'button',
    }] }, options), IngestContractError)
    assert.throws(() => validateIngest('behavior', { key: 'zj_pk', events: [{
      client_event_id: id, kind: 'behavior', visitor_id: 'visitor_a', occurred_at: now.toISOString(), page_key: '/pricing', action: 'scroll_depth', depth_bucket: 42,
    }] }, options), IngestContractError)
  })

  it('accepts structured Web Vitals and rejects the legacy performance shape', () => {
    const result = validateIngest('performance', { key: 'zj_pk', events: [{
      client_event_id: id, kind: 'performance', visitor_id: 'visitor_a', occurred_at: now.toISOString(), page_key: '/pricing', route: '/pricing',
      navigation_type: 'navigate', metric: { name: 'LCP', value: 2300, rating: 'good', metric_id: 'v3-1' },
      viewport: { width_bucket: 1200, height_bucket: 800 }, browser: 'chrome', device: 'desktop',
    }] }, options)
    assert.equal(result.lane, 'performance')
    assert.throws(() => validateIngest('performance', { key: 'zj_pk', events: [{
      client_event_id: id, kind: 'performance', visitor_id: 'visitor_a', occurred_at: now.toISOString(), page_key: '/pricing',
      metric_name: 'LCP', metric_value: 2300, metric_id: 'legacy',
    }] }, options), IngestContractError)
  })

  it('claims lane-scoped receipts once while allowing identical ids in a different lane', async () => {
    const claimed = new Set<string>()
    const store: ReceiptStore = { claim: async (key: ReceiptKey) => { const value = [key.tenantId, key.projectId, key.lane, key.clientEventId].join(':'); if (claimed.has(value)) return false; claimed.add(value); return true } }
    const scope = { tenantId: 'tenant_1', projectId: 'project_1' }
    assert.deepEqual(await claimReceipts(store, scope, 'analytics' as IngestLane, [id, id]), { accepted: 1, duplicate: 1, sampled: 0, rate_limited: 0, dropped: 0 })
    assert.equal((await claimReceipts(store, scope, 'error' as IngestLane, [id])).accepted, 1)
  })

  it('requires replay chunks to stay in one valid session and sequence range', () => {
    const chunk = replayChunk()
    const result = validateIngest('replay', { key: 'zj_pk', session: { replay_session_id: id, visitor_id: 'visitor_a', started_at: now.toISOString(), policy_version: 1, initial_route: '/pricing', sample_decision: true }, chunks: [chunk] }, options)
    assert.equal(result.lane, 'replay')
    assert.throws(() => validateIngest('replay', { key: 'zj_pk', session: { replay_session_id: id, visitor_id: 'visitor_a', started_at: now.toISOString(), policy_version: 1, initial_route: '/pricing', sample_decision: true }, chunks: [{ ...chunk, sequence_start: 2, sequence_end: 1 }] }, options), IngestContractError)
  })

  it('rejects replay text, form values and arbitrary DOM-shaped fields before receipts', () => {
    const raw = JSON.stringify({ version: 1, events: [{ t: 'interaction', at: now.getTime(), action: 'click', x: 1, y: 1, text: 'secret' }] })
    const chunk = { ...replayChunk(), data: Buffer.from(raw).toString('base64'), sha256: createHash('sha256').update(raw).digest('hex') }
    assert.throws(() => validateIngest('replay', { key: 'zj_pk', session: { replay_session_id: id, visitor_id: 'visitor_a', started_at: now.toISOString(), policy_version: 1, initial_route: '/pricing', sample_decision: true }, chunks: [chunk] }, options), (error: unknown) => error instanceof IngestContractError && error.code === 'invalid_replay_payload')
  })

  it('accepts a closed structural snapshot but rejects text and URL attributes', () => {
    const session = { replay_session_id: id, visitor_id: 'visitor_a', started_at: now.toISOString(), policy_version: 1, initial_route: '/pricing', sample_decision: true }
    const valid = replayChunkWithEvents([{ t: 'snapshot', at: now.getTime(), tree: { tag: 'main', attrs: { role: 'main' }, children: [{ tag: 'button', attrs: { type: 'button', disabled: true } }] } }])
    assert.equal(validateIngest('replay', { key: 'zj_pk', session, chunks: [valid] }, options).lane, 'replay')
    const unsafe = replayChunkWithEvents([{ t: 'snapshot', at: now.getTime(), tree: { tag: 'a', attrs: { href: 'https://private.example/token' } } }])
    assert.throws(() => validateIngest('replay', { key: 'zj_pk', session, chunks: [unsafe] }, options), (error: unknown) => error instanceof IngestContractError && error.code === 'invalid_replay_payload')
  })
})

function replayChunk() {
  const raw = JSON.stringify({ version: 1, events: [{ t: 'checkout', at: now.getTime(), route: '/pricing', viewport: { width: 1280, height: 800 } }] })
  return { chunk_id: '83f3992a-6a55-4704-a032-9e56c9e65713', sequence_start: 0, sequence_end: 0, encoding: 'rrweb-json' as const, data: Buffer.from(raw).toString('base64'), sha256: createHash('sha256').update(raw).digest('hex'), occurred_from: now.toISOString(), occurred_to: now.toISOString() }
}
function replayChunkWithEvents(events: unknown[]) {
  const raw = JSON.stringify({ version: 1, events })
  return { chunk_id: '83f3992a-6a55-4704-a032-9e56c9e65713', sequence_start: 0, sequence_end: events.length - 1, encoding: 'rrweb-json' as const, data: Buffer.from(raw).toString('base64'), sha256: createHash('sha256').update(raw).digest('hex'), occurred_from: now.toISOString(), occurred_to: now.toISOString() }
}

describe('error Source Map fields', () => {
  it('accepts bounded dist, replay hints, and sanitized generated frames only', () => {
    const payload = validateIngest('error', { key: 'zj_bro_key', events: [{ client_event_id: 'b2f35e73-0f73-4384-9e6f-08f9b4e4d2e5', kind: 'error', visitor_id: 'visitor', occurred_at: now.toISOString(), release: 'web@1', dist: 'canary', replay_session_id: '83f3992a-6a55-4704-a032-9e56c9e65713', error: { mechanism: 'manual', type: 'Error', message: 'boom', frames: [{ filename: '/assets/app.js', function: 'render', line: 1, column: 0, in_app: true }] } }] }, { now: now, pagePolicy: { allowedPageKeys: [], routeTemplates: [] } })
    if (payload.lane !== 'error') throw new Error('expected error payload')
    assert.equal(payload.events[0]?.dist, 'canary')
    assert.equal(payload.events[0]?.replay_session_id, '83f3992a-6a55-4704-a032-9e56c9e65713')
    assert.deepEqual((payload.events[0]?.error as Record<string, unknown>).frames, [{ filename: '/assets/app.js', function: 'render', line: 1, column: 0, in_app: true }])
    assert.throws(() => validateIngest('error', { key: 'zj_bro_key', events: [{ client_event_id: 'b2f35e73-0f73-4384-9e6f-08f9b4e4d2e5', kind: 'error', visitor_id: 'visitor', occurred_at: now.toISOString(), error: { mechanism: 'manual', type: 'Error', message: 'boom', frames: [{ filename: 'https://leak.test/assets/app.js', line: 1, column: 0 }] } }] }, { now: now, pagePolicy: { allowedPageKeys: [], routeTemplates: [] } }))
  })
})
