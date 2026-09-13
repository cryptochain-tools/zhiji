import assert from 'node:assert/strict'
import test from 'node:test'
import { ZhijiMobileClient } from '../.test-dist/index.js'

const base = { key: 'zj_mob_abcdefghijklmnopqrstuvwxyz', platform: 'react_native', applicationId: 'com.example.app', applicationVersion: '1.2.3', endpointBaseUrl: 'https://telemetry.example.com' }
const response = data => ({ ok: true, status: 202, headers: { get: () => null }, async json() { return { data } } })

test('sends mobile declaration headers, bounded properties, and standard event envelope', async () => {
  const calls = []
  const client = new ZhijiMobileClient({ ...base, fetch: async (url, init) => { calls.push({ url, init }); return response({ accepted: 1, duplicate: 0, dropped: 0 }) } })
  client.track('order_created', { plan: 'pro', email: 'remove@example.com', count: 2 })
  const result = await client.flush()
  assert.equal(result.analytics.accepted, 1)
  assert.equal(calls[0].url, 'https://telemetry.example.com/api/ingest/mobile/events')
  assert.equal(calls[0].init.headers['X-Zhiji-Mobile-Platform'], 'react_native')
  const body = JSON.parse(calls[0].init.body)
  assert.deepEqual(body.events[0].properties, { plan: 'pro', count: 2 })
  await client.shutdown()
})

test('associates login only after receipt acceptance and retains anonymous id on logout', async () => {
  const calls = []
  let accepted = false
  const client = new ZhijiMobileClient({ ...base, fetch: async (_url, init) => { calls.push(JSON.parse(init.body)); return response({ accepted: accepted ? 1 : 0, duplicate: 0, dropped: accepted ? 0 : 1 }) } })
  const visitorId = client.getVisitorId()
  assert.equal(await client.login('user_1', 'signed-assertion'), false)
  client.track('after_failed_login')
  accepted = true
  assert.equal(await client.login('user_1', 'signed-assertion'), true)
  client.track('after_login')
  await client.flush()
  assert.equal(calls.at(-1).events[0].business_user_id, 'user_1')
  client.logout()
  client.track('after_logout')
  await client.flush()
  assert.equal(calls.at(-1).events[0].business_user_id, undefined)
  assert.equal(client.getVisitorId(), visitorId)
  await client.shutdown()
})

test('restores visitor only before events and maps performance to the supported analytics lane', async () => {
  const visitor = '11111111-1111-4111-8111-111111111111'
  const calls = []
  const client = new ZhijiMobileClient({ ...base, visitorStorage: { async getItem() { return visitor }, async setItem() {} }, fetch: async (_url, init) => { calls.push(JSON.parse(init.body)); return response({ accepted: 1, duplicate: 0, dropped: 0 }) } })
  await client.ready()
  assert.equal(client.getVisitorId(), visitor)
  client.capturePerformance({ name: 'screen_ready', value: 125, unit: 'ms', attributes: { notification: 'hidden', screen: 'home' } })
  await client.flush()
  assert.equal(calls[0].events[0].name, 'mobile_performance')
  assert.deepEqual(calls[0].events[0].properties, { metric_name: 'screen_ready', metric_value: 125, metric_unit: 'ms', screen: 'home' })
  await client.shutdown()
})

test('retries transient failures with the original client event id', async () => {
  const calls = []
  const client = new ZhijiMobileClient({ ...base, fetch: async (_url, init) => { calls.push(JSON.parse(init.body)); return calls.length === 1 ? { ok: false, status: 503, headers: { get: () => '0' }, async json() { return {} } } : response({ accepted: 1, duplicate: 0, dropped: 0 }) } })
  client.track('retry_me', undefined, { clientEventId: '22222222-2222-4222-8222-222222222222' })
  await client.flush()
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(calls.length, 2)
  assert.equal(calls[1].events[0].client_event_id, '22222222-2222-4222-8222-222222222222')
  await client.shutdown()
})

test('requires a secure origin unless explicit development opt-in is used', () => {
  assert.throws(() => new ZhijiMobileClient({ ...base, endpointBaseUrl: 'http://localhost:7001', fetch: async () => response({}) }))
  assert.doesNotThrow(() => new ZhijiMobileClient({ ...base, endpointBaseUrl: 'http://localhost:7001', allowInsecureTransport: true, fetch: async () => response({}) }))
})
