import assert from 'node:assert/strict'
import test from 'node:test'
import { ZhijiNodeClient } from '../.test-dist/index.js'

test('keeps identities request-scoped and posts an exact analytics envelope', async () => {
  const calls = []
  const client = new ZhijiNodeClient({ key: 'zj_ser_abcdefghijklmnopqrstuvwxyz', fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 202, async json() { return { data: { accepted: 1, duplicate: 0, dropped: 0 } } } } } })
  client.capture({ name: 'order_created', visitorId: 'v_a', businessUserId: 'u_a', properties: { plan: 'pro', email: 'drop@example.com' } })
  const result = await client.flush()
  assert.equal(result.analytics.accepted, 1)
  const body = JSON.parse(calls[0].init.body)
  assert.equal(calls[0].url, '/api/ingest/server/events')
  assert.equal(body.events[0].business_user_id, 'u_a')
  assert.deepEqual(body.events[0].properties, { plan: 'pro' })
})

test('flushes at 20 events and retries retryable failures with Retry-After', async () => {
  const calls = []
  const client = new ZhijiNodeClient({ key: 'zj_ser_abcdefghijklmnopqrstuvwxyz', fetch: async (_url, init) => {
    calls.push(JSON.parse(init.body))
    return calls.length === 1
      ? { ok: false, status: 429, headers: { get: () => '0' }, async json() { return {} } }
      : { ok: true, status: 202, headers: { get: () => null }, async json() { return { data: { accepted: 20, duplicate: 0, dropped: 0 } } } }
  } })
  for (let index = 0; index < 20; index += 1) client.capture({ name: 'queued', visitorId: `v_${index}` })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(calls.length, 2)
  assert.equal(calls[0].events.length, 20)
})

test('bounds a lane at 512 KiB without writing telemetry to disk', async () => {
  const calls = []
  const client = new ZhijiNodeClient({ key: 'zj_ser_abcdefghijklmnopqrstuvwxyz', fetch: async (_url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 202, async json() { return { data: { accepted: 0, duplicate: 0, dropped: 0 } } } } } })
  client.capture({ name: 'too_large', visitorId: 'v_a', properties: Object.fromEntries(Array.from({ length: 1100 }, (_, index) => [`field_${index}`, 'x'.repeat(512)])) })
  const result = await client.flush()
  assert.equal(result.analytics.attempted, 0)
  assert.equal(calls.length, 0)
})

test('stops after at most three retry attempts', async () => {
  let calls = 0
  const client = new ZhijiNodeClient({ key: 'zj_ser_abcdefghijklmnopqrstuvwxyz', fetch: async () => { calls += 1; return { ok: false, status: 503, headers: { get: () => '0' }, async json() { return {} } } } })
  client.capture({ name: 'retry_limited', visitorId: 'v_a' })
  await client.flush()
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(calls, 4)
})
