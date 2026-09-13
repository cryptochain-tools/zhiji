import assert from 'node:assert/strict'
import { createCipheriv, randomBytes } from 'node:crypto'
import test from 'node:test'
import { NotificationDeliveryHandler, configuredTargetsFromEnvironment, invitationKeyFromEnvironment } from '../src/notification-delivery'
import { TerminalOutboxDeliveryError } from '../../server/app/service/worker'
import { LeasedOutboxMessage } from '../../server/app/service/worker/types'

const tenant = '00000000-0000-4000-8000-000000000001'; const project = '00000000-0000-4000-8000-000000000002'; const deliveryId = '00000000-0000-4000-8000-000000000003'; const targetId = '00000000-0000-4000-8000-000000000004'
function message(topic = 'notification_delivery', payload: Record<string, unknown> = { notification_delivery_id: deliveryId }): LeasedOutboxMessage { return { id: '00000000-0000-4000-8000-000000000005', tenant_id: tenant, project_id: project, topic, idempotency_key: 'test', payload, available_at: new Date(), lease_owner: 'test', lease_expires_at: new Date(), attempt_count: 1, max_attempts: 5 } }

test('notification delivery reloads enabled verified target and emits scrubbed payload through an injected transport', async () => {
  const calls: string[] = []; let sent: { body: string; headers: Record<string, string> } | undefined
  const database = { async query<T extends object>(text: string) { calls.push(text); if (text.includes('FROM notification_deliveries')) return { rows: [{ id: targetId, tenant_id: tenant, project_id: project, type: 'webhook', label: 'ops', rule_id: '00000000-0000-4000-8000-000000000006', rule_name: 'Errors', rule_type: 'error_count', alert_instance_id: '00000000-0000-4000-8000-000000000007', status: 'active', triggered_at: new Date('2026-09-12T00:00:00Z'), summary: { count: 2, stack: 'private', visitor_id: 'private' }, project_name: 'Demo' }] as T[], rowCount: 1 }; return { rows: [] as T[], rowCount: 1 } } }
  const transport = { async sendEmail() { throw new Error('unexpected') }, async sendHttps(input: { body: string; headers: Record<string, string> }) { sent = input } }
  const targets = configuredTargetsFromEnvironment(JSON.stringify({ [targetId]: { type: 'webhook', url: 'https://hooks.example.test/notify', signing_secret: 'secret' } }))
  await new NotificationDeliveryHandler(database, targets, transport, null, new URL('https://zhiji.example'), [ 'example.test' ]).deliver(message())
  assert.ok(sent)
  const payload = JSON.parse(sent.body)
  assert.deepEqual(payload.summary, { count: 2 })
  assert.equal(payload.url, `https://zhiji.example/console/alerts?project_id=${project}&alert_instance_id=00000000-0000-4000-8000-000000000007`)
  assert.equal(typeof sent.headers['x-zhiji-signature'], 'string')
  assert.ok(calls.some(call => call.includes("status = 'delivered'")))
})

test('inactive or absent target configuration fails closed and records a terminal status', async () => {
  const calls: string[] = []
  const database = { async query<T extends object>(text: string) { calls.push(text); return { rows: [] as T[], rowCount: 0 } } }
  const handler = new NotificationDeliveryHandler(database, new Map(), null, null, null, [])
  await assert.rejects(() => handler.deliver(message()), (error: unknown) => error instanceof TerminalOutboxDeliveryError && error.code === 'notification_target_inactive')
  assert.ok(calls.some(call => call.includes("status = 'cancelled'")))
})

test('invalid configured email recipient is terminal and pauses its verified target', async () => {
  const calls: string[] = []
  const database = { async query<T extends object>(text: string) { calls.push(text); if (text.includes('FROM notification_deliveries')) return { rows: [{ id: targetId, tenant_id: tenant, project_id: project, type: 'email', label: 'member', rule_id: '00000000-0000-4000-8000-000000000006', rule_name: 'Errors', rule_type: 'error_count', alert_instance_id: '00000000-0000-4000-8000-000000000007', status: 'active', triggered_at: new Date(), summary: {}, project_name: 'Demo' }] as T[], rowCount: 1 }; return { rows: [] as T[], rowCount: 0 } } }
  const targets = configuredTargetsFromEnvironment(JSON.stringify({ [targetId]: { type: 'email', email: 'not-a-member@example.test' } }))
  const handler = new NotificationDeliveryHandler(database, targets, { async sendEmail() { throw new Error('unexpected') }, async sendHttps() { throw new Error('unexpected') } }, null, null, [])
  await assert.rejects(() => handler.deliver(message()), (error: unknown) => error instanceof TerminalOutboxDeliveryError && error.code === 'notification_recipient_invalid')
  assert.ok(calls.some(call => call.includes("status = 'failed'"))); assert.ok(calls.some(call => call.includes('UPDATE notification_targets SET enabled = false')))
})

test('invitation envelope is decrypted only in worker and pending invitation is sent through injected SMTP transport', async () => {
  const key = randomBytes(32); const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const plaintext = JSON.stringify({ email: 'person@example.test', token: 'x'.repeat(32) }); const encrypted = Buffer.concat([ cipher.update(plaintext), cipher.final() ])
  let email: { to: string; text: string } | undefined
  const database = { async query<T extends object>() { return { rows: [{ email_normalized: 'person@example.test' }] as T[], rowCount: 1 } } }
  const handler = new NotificationDeliveryHandler(database, new Map(), { async sendHttps() { throw new Error('unexpected') }, async sendEmail(input: { to: string; text: string }) { email = input } }, invitationKeyFromEnvironment(key.toString('base64url')), new URL('https://zhiji.example'), [])
  await handler.deliver(message('invitation_email', { invitation_id: deliveryId, delivery: { v: 1, alg: 'A256GCM', iv: iv.toString('base64url'), ciphertext: encrypted.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') } }))
  assert.equal(email?.to, 'person@example.test'); assert.match(email?.text ?? '', /accept-invitation/)
})

test('report delivery rechecks schedule and target, then emits only a report delivery identifier and safe metadata', async () => {
  let sent: { body: string } | undefined; const calls: string[] = []
  const reportDeliveryId = '00000000-0000-4000-8000-000000000008'
  const database = { async query<T extends object>(text: string) { calls.push(text); if (text.includes('FROM report_run_deliveries')) return { rows: [{ id: targetId, tenant_id: tenant, project_id: project, type: 'webhook', label: 'ops', report_run_id: '00000000-0000-4000-8000-000000000009', schedule_id: '00000000-0000-4000-8000-000000000010', scheduled_for: new Date('2026-09-12T00:00:00Z'), project_name: 'Demo' }] as T[], rowCount: 1 }; return { rows: [] as T[], rowCount: 1 } } }
  const targets = configuredTargetsFromEnvironment(JSON.stringify({ [targetId]: { type: 'webhook', url: 'https://hooks.example.test/report', signing_secret: 'secret' } }))
  const handler = new NotificationDeliveryHandler(database, targets, { async sendEmail() { throw new Error('unexpected') }, async sendHttps(input: { body: string }) { sent = input } }, null, new URL('https://zhiji.example'), [ 'example.test' ])
  await handler.deliver(message('report_run_delivery', { report_run_delivery_id: reportDeliveryId }))
  const body = JSON.parse(sent?.body ?? '{}')
  assert.deepEqual(Object.keys(body).sort(), [ 'delivery_id', 'project', 'report_run_id', 'schedule_id', 'scheduled_for', 'url', 'version' ])
  assert.equal(body.delivery_id, targetId); assert.doesNotMatch(JSON.stringify(body), /artifact|webhook|secret/i)
  assert.equal(body.url, `https://zhiji.example/console/reports?project_id=${project}&report_run_id=00000000-0000-4000-8000-000000000009`)
  assert.ok(calls.some(text => text.includes("UPDATE report_run_deliveries SET status='delivered'")))
})

test('inactive report delivery is cancelled without reading an artifact or sending external data', async () => {
  const calls: string[]=[]; const database={async query<T extends object>(text:string){calls.push(text);return{rows:[] as T[],rowCount:0}}}
  const handler=new NotificationDeliveryHandler(database,new Map(),null,null,null,[])
  await assert.rejects(()=>handler.deliver(message('report_run_delivery',{report_run_delivery_id:'00000000-0000-4000-8000-000000000008'})),(error:unknown)=>error instanceof TerminalOutboxDeliveryError&&error.code==='report_delivery_inactive')
  assert.ok(calls.some(text=>text.includes("UPDATE report_run_deliveries SET status='cancelled'")));assert.equal(calls.some(text=>text.includes('artifact_ref')),false)
})
