import { createDecipheriv, createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { connect as tlsConnect } from 'node:tls'
import { TerminalOutboxDeliveryError } from '../../server/app/service/worker'
import { DatabaseClient } from '../../server/app/service/database/types'
import { LeasedOutboxMessage } from '../../server/app/service/worker/types'

type NotificationType = 'lark_bot' | 'email' | 'webhook'
type AlertTarget = { id: string; tenant_id: string; project_id: string; type: NotificationType; label: string; rule_id: string; rule_name: string; rule_type: string; alert_instance_id: string; status: string; triggered_at: Date; summary: Record<string, unknown>; project_name: string }
type ReportTarget = { id: string; tenant_id: string; project_id: string; type: NotificationType; label: string; report_run_id: string; schedule_id: string; scheduled_for: Date; project_name: string }
type ConfiguredTarget = { type: NotificationType; email?: string; url?: string; signing_secret?: string }
export type NotificationTransport = { sendEmail(input: { to: string; subject: string; text: string; html: string }): Promise<void>; sendHttps(input: { url: URL; headers: Record<string, string>; body: string; allowedHosts: readonly string[] }): Promise<void> }

const SAFE_SUMMARY_KEYS = new Set([ 'count', 'window_seconds', 'metric', 'sample_count', 'poor_ratio', 'release' ])

/** Deployment-owned target configuration. It is deliberately separate from DB metadata and API input. */
export function configuredTargetsFromEnvironment(value: string | undefined): ReadonlyMap<string, ConfiguredTarget> {
  if (!value) return new Map()
  let raw: unknown
  try { raw = JSON.parse(value) } catch { throw new Error('NOTIFICATION_DELIVERY_TARGETS must be valid JSON') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('NOTIFICATION_DELIVERY_TARGETS must be an object')
  const result = new Map<string, ConfiguredTarget>()
  for (const [ id, entry ] of Object.entries(raw)) {
    if (!uuid(id) || !entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('NOTIFICATION_DELIVERY_TARGETS has an invalid target')
    const target = entry as Record<string, unknown>
    if (target.type !== 'email' && target.type !== 'webhook' && target.type !== 'lark_bot') throw new Error('NOTIFICATION_DELIVERY_TARGETS has an invalid type')
    const configured: ConfiguredTarget = { type: target.type }
    if (typeof target.email === 'string') configured.email = normalizedEmail(target.email)
    if (typeof target.url === 'string') configured.url = target.url
    if (typeof target.signing_secret === 'string') configured.signing_secret = target.signing_secret
    if ((configured.type === 'email' && !configured.email) || (configured.type !== 'email' && !configured.url)) throw new Error('NOTIFICATION_DELIVERY_TARGETS has incomplete transport configuration')
    result.set(id, configured)
  }
  return result
}

export function createTransportFromEnvironment(environment: NodeJS.ProcessEnv): NotificationTransport | null {
  return new SmtpAndPinnedHttpsTransport(environment.SMTP_URL, environment.SMTP_FROM ? normalizedEmail(environment.SMTP_FROM) : null, (environment.SMTP_ALLOWED_HOSTS ?? '').split(',').map(value => value.trim()).filter(Boolean))
}

/** All delivery data is reconstructed server-side; an outbox never carries endpoints or user data. */
export class NotificationDeliveryHandler {
  private readonly allowedHosts: readonly string[]
  constructor(private readonly database: DatabaseClient, private readonly targets: ReadonlyMap<string, ConfiguredTarget>, private readonly transport: NotificationTransport | null, private readonly invitationKey: Buffer | null, private readonly publicBaseUrl: URL | null, allowedHosts: readonly string[]) {
    this.allowedHosts = allowedHosts.map(host => host.toLowerCase()).filter(host => /^[a-z0-9.-]{1,253}$/.test(host))
  }

  async deliver(message: LeasedOutboxMessage): Promise<void> {
    if (message.topic === 'invitation_email') return this.deliverInvitation(message)
    if (message.topic === 'notification_delivery') return this.deliverNotification(message)
    if (message.topic === 'report_run_delivery') return this.deliverReportRun(message)
    throw new TerminalOutboxDeliveryError('outbox_topic_unhandled')
  }

  private async deliverInvitation(message: LeasedOutboxMessage): Promise<void> {
    const invitationId = stringField(message.payload, 'invitation_id')
    const envelope = objectField(message.payload, 'delivery')
    const delivery = decryptInvitation(envelope, this.invitationKey)
    const valid = await this.database.query<{ email_normalized: string }>(
      `SELECT email_normalized FROM invitations WHERE id = $1 AND tenant_id = $2
       AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, [ invitationId, message.tenant_id ],
    )
    if (valid.rowCount !== 1 || valid.rows[0]?.email_normalized !== delivery.email) throw new TerminalOutboxDeliveryError('invitation_not_deliverable')
    if (!this.transport || !this.publicBaseUrl) throw new TerminalOutboxDeliveryError('invitation_delivery_unavailable')
    const url = new URL('/accept-invitation', this.publicBaseUrl); url.searchParams.set('token', delivery.token)
    await this.transport.sendEmail({ to: delivery.email, subject: '知迹邀请', text: `请打开邀请链接完成加入：${url.toString()}`, html: `<p>请打开邀请链接完成加入：</p><p><a href="${escapeHtml(url.toString())}">接受邀请</a></p>` })
  }

  private async deliverNotification(message: LeasedOutboxMessage): Promise<void> {
    const deliveryId = stringField(message.payload, 'notification_delivery_id')
    const loaded = await this.loadDelivery(deliveryId, message)
    if (!loaded) {
      await this.cancelDelivery(deliveryId, message)
      throw new TerminalOutboxDeliveryError('notification_target_inactive')
    }
    const target = this.targets.get(loaded.id)
    if (!target || target.type !== loaded.type || !this.transport) {
      await this.failDelivery(deliveryId, message, 'notification_delivery_unavailable')
      throw new TerminalOutboxDeliveryError('notification_delivery_unavailable')
    }
    const body = outboundAlert(loaded, this.publicBaseUrl)
    try {
      if (target.type === 'email') {
        if (!target.email || !await this.memberEmail(loaded.tenant_id, target.email)) throw new TerminalOutboxDeliveryError('notification_recipient_invalid')
        await this.transport.sendEmail({ to: target.email, subject: `知迹告警：${loaded.rule_name}`, text: alertText(body), html: `<pre>${escapeHtml(alertText(body))}</pre>` })
      } else {
        const url = validatedUrl(target.url, target.type, this.allowedHosts)
        const payload = JSON.stringify(body)
        const headers: Record<string, string> = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)), 'x-zhiji-timestamp': new Date().toISOString() }
        if (target.type === 'webhook') {
          if (!target.signing_secret || target.signing_secret.length > 512) throw new TerminalOutboxDeliveryError('notification_signing_unavailable')
          headers['x-zhiji-signature'] = `sha256=${createHmac('sha256', target.signing_secret).update(`${headers['x-zhiji-timestamp']}.${payload}`).digest('hex')}`
        }
        await this.transport.sendHttps({ url, headers, body: payload, allowedHosts: target.type === 'lark_bot' ? [ 'open.feishu.cn' ] : this.allowedHosts })
      }
      await this.markDelivered(deliveryId, message)
    } catch (error) {
      if (error instanceof TerminalOutboxDeliveryError) { await this.failDelivery(deliveryId, message, error.code); if (pausesTarget(error.code)) await this.pauseTarget(loaded, message); throw error }
      if (message.attempt_count >= message.max_attempts) {
        await this.failDelivery(deliveryId, message, 'notification_delivery_failed')
        throw new TerminalOutboxDeliveryError('notification_delivery_failed')
      }
      await this.noteAttempt(deliveryId, message)
      throw error
    }
  }

  private async deliverReportRun(message: LeasedOutboxMessage): Promise<void> {
    const deliveryId = stringField(message.payload, 'report_run_delivery_id')
    const loaded = await this.loadReportDelivery(deliveryId, message)
    if (!loaded) { await this.cancelReportDelivery(deliveryId, message); throw new TerminalOutboxDeliveryError('report_delivery_inactive') }
    const target = this.targets.get(loaded.id)
    if (!target || target.type !== loaded.type || !this.transport) { await this.failReportDelivery(deliveryId, message, 'report_delivery_unavailable'); throw new TerminalOutboxDeliveryError('report_delivery_unavailable') }
    const body = outboundReport(loaded, this.publicBaseUrl)
    try {
      if (target.type === 'email') {
        if (!target.email || !await this.memberEmail(loaded.tenant_id, target.email)) throw new TerminalOutboxDeliveryError('notification_recipient_invalid')
        await this.transport.sendEmail({ to: target.email, subject: `知迹报表已生成`, text: reportText(body), html: `<pre>${escapeHtml(reportText(body))}</pre>` })
      } else {
        const url = validatedUrl(target.url, target.type, this.allowedHosts); const payload = JSON.stringify(body)
        const headers: Record<string, string> = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)), 'x-zhiji-timestamp': new Date().toISOString() }
        if (target.type === 'webhook') { if (!target.signing_secret || target.signing_secret.length > 512) throw new TerminalOutboxDeliveryError('notification_signing_unavailable'); headers['x-zhiji-signature'] = `sha256=${createHmac('sha256', target.signing_secret).update(`${headers['x-zhiji-timestamp']}.${payload}`).digest('hex')}` }
        await this.transport.sendHttps({ url, headers, body: payload, allowedHosts: target.type === 'lark_bot' ? [ 'open.feishu.cn' ] : this.allowedHosts })
      }
      await this.markReportDelivered(deliveryId, message)
    } catch (error) {
      if (error instanceof TerminalOutboxDeliveryError) { await this.failReportDelivery(deliveryId, message, error.code); if (pausesTarget(error.code)) await this.pauseTarget(loaded, message); throw error }
      if (message.attempt_count >= message.max_attempts) { await this.failReportDelivery(deliveryId, message, 'report_delivery_failed'); throw new TerminalOutboxDeliveryError('report_delivery_failed') }
      await this.noteReportAttempt(deliveryId, message); throw error
    }
  }
  private async loadReportDelivery(id: string, message: LeasedOutboxMessage): Promise<ReportTarget | null> {
    const result = await this.database.query<ReportTarget>(`SELECT target.id,target.tenant_id,target.project_id,target.type,target.label,run.id AS report_run_id,run.schedule_id,run.scheduled_for,project.name AS project_name FROM report_run_deliveries delivery JOIN report_runs run ON run.id=delivery.report_run_id AND run.tenant_id=delivery.tenant_id AND run.project_id=delivery.project_id AND run.status='completed' JOIN report_schedules schedule ON schedule.id=run.schedule_id AND schedule.tenant_id=run.tenant_id AND schedule.project_id=run.project_id AND schedule.enabled JOIN notification_targets target ON target.id=delivery.target_id AND target.tenant_id=delivery.tenant_id AND target.project_id=delivery.project_id JOIN projects project ON project.id=delivery.project_id AND project.tenant_id=delivery.tenant_id AND project.deletion_status='active' WHERE delivery.id=$1 AND delivery.tenant_id=$2 AND delivery.project_id=$3 AND delivery.status='queued' AND target.enabled AND target.verified_at IS NOT NULL AND target.disabled_at IS NULL`,[id,message.tenant_id,message.project_id])
    return result.rows[0] ?? null
  }
  private async loadDelivery(id: string, message: LeasedOutboxMessage): Promise<AlertTarget | null> {
    const result = await this.database.query<AlertTarget>(
      `SELECT target.id, target.tenant_id, target.project_id, target.type, target.label,
              rule.id AS rule_id, rule.name AS rule_name, rule.rule_type,
              instance.id AS alert_instance_id, instance.status, instance.last_triggered_at AS triggered_at,
              instance.payload_summary AS summary, project.name AS project_name
       FROM notification_deliveries AS delivery
       JOIN notification_targets AS target ON target.id = delivery.target_id AND target.tenant_id = delivery.tenant_id AND target.project_id = delivery.project_id
       JOIN alert_instances AS instance ON instance.id = delivery.alert_instance_id AND instance.tenant_id = delivery.tenant_id AND instance.project_id = delivery.project_id
       JOIN alert_rules AS rule ON rule.id = instance.rule_id AND rule.tenant_id = delivery.tenant_id AND rule.project_id = delivery.project_id
       JOIN projects AS project ON project.id = delivery.project_id AND project.tenant_id = delivery.tenant_id AND project.deletion_status = 'active'
       WHERE delivery.id = $1 AND delivery.tenant_id = $2 AND delivery.project_id = $3 AND delivery.status = 'queued'
         AND rule.enabled AND target.enabled AND target.verified_at IS NOT NULL AND target.disabled_at IS NULL`, [ id, message.tenant_id, message.project_id ],
    )
    return result.rows[0] ?? null
  }
  private async markReportDelivered(id: string, message: LeasedOutboxMessage): Promise<void> { await this.database.query(`UPDATE report_run_deliveries SET status='delivered',delivered_at=now(),last_attempt_at=now(),attempt_count=attempt_count+1,last_error_code=NULL WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND status='queued'`,[id,message.tenant_id,message.project_id]) }
  private async noteReportAttempt(id: string, message: LeasedOutboxMessage): Promise<void> { await this.database.query(`UPDATE report_run_deliveries SET last_attempt_at=now(),attempt_count=attempt_count+1,last_error_code='report_delivery_retry' WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND status='queued'`,[id,message.tenant_id,message.project_id]) }
  private async failReportDelivery(id: string, message: LeasedOutboxMessage, code: string): Promise<void> { await this.database.query(`UPDATE report_run_deliveries SET status='failed',last_attempt_at=now(),attempt_count=attempt_count+1,last_error_code=$4 WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND status='queued'`,[id,message.tenant_id,message.project_id,code]) }
  private async cancelReportDelivery(id: string, message: LeasedOutboxMessage): Promise<void> { await this.database.query(`UPDATE report_run_deliveries SET status='cancelled',last_attempt_at=now(),last_error_code='report_delivery_inactive' WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND status='queued'`,[id,message.tenant_id,message.project_id]) }
  private async memberEmail(tenantId: string, email: string): Promise<boolean> { const r = await this.database.query<{ id: string }>('SELECT user_id AS id FROM memberships JOIN users ON users.id = memberships.user_id WHERE memberships.tenant_id = $1 AND users.email_normalized = $2 LIMIT 1', [ tenantId, email ]); return r.rowCount === 1 }
  private async markDelivered(id: string, message: LeasedOutboxMessage): Promise<void> { await this.database.query(`UPDATE notification_deliveries SET status = 'delivered', delivered_at = now(), last_attempt_at = now(), attempt_count = attempt_count + 1, last_error_code = NULL WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND status = 'queued'`, [ id, message.tenant_id, message.project_id ]) }
  private async noteAttempt(id: string, message: LeasedOutboxMessage): Promise<void> { await this.database.query(`UPDATE notification_deliveries SET last_attempt_at = now(), attempt_count = attempt_count + 1, last_error_code = 'notification_delivery_retry' WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND status = 'queued'`, [ id, message.tenant_id, message.project_id ]) }
  private async failDelivery(id: string, message: LeasedOutboxMessage, code: string): Promise<void> { await this.database.query(`UPDATE notification_deliveries SET status = 'failed', last_attempt_at = now(), attempt_count = attempt_count + 1, last_error_code = $4 WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND status = 'queued'`, [ id, message.tenant_id, message.project_id, code ]) }
  private async pauseTarget(target: Pick<AlertTarget, 'id'>, message: LeasedOutboxMessage): Promise<void> { await this.database.query(`UPDATE notification_targets SET enabled = false, disabled_at = now() WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND enabled`, [ target.id, message.tenant_id, message.project_id ]) }
  private async cancelDelivery(id: string, message: LeasedOutboxMessage): Promise<void> { await this.database.query(`UPDATE notification_deliveries SET status = 'cancelled', last_attempt_at = now(), last_error_code = 'notification_target_inactive' WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND status = 'queued'`, [ id, message.tenant_id, message.project_id ]) }
}

/** SMTP uses implicit TLS only. HTTPS uses a validated DNS result pinned through Node's lookup hook, follows no redirects and caps both request/response. */
export class SmtpAndPinnedHttpsTransport implements NotificationTransport {
  private readonly smtp: URL | null
  private readonly smtpAllowedHosts: readonly string[]
  constructor(smtpUrl: string | undefined, private readonly from: string | null, smtpAllowedHosts: readonly string[]) {
    this.smtp = smtpUrl ? new URL(smtpUrl) : null
    if (this.smtp && (this.smtp.protocol !== 'smtps:' || !this.smtp.hostname)) throw new Error('SMTP_URL must use smtps://')
    this.smtpAllowedHosts = smtpAllowedHosts.map(host => host.toLowerCase()).filter(host => /^[a-z0-9.-]{1,253}$/.test(host))
  }
  async sendEmail(input: { to: string; subject: string; text: string; html: string }): Promise<void> {
    if (Buffer.byteLength(input.text) > 16_384 || Buffer.byteLength(input.html) > 32_768) throw new TerminalOutboxDeliveryError('notification_payload_invalid')
    if (!this.smtp || !this.from || !isAllowedHost(this.smtp.hostname, this.smtpAllowedHosts)) throw new TerminalOutboxDeliveryError('smtp_delivery_unavailable')
    const addresses = await lookup(this.smtp.hostname, { all: true, verbatim: true }); const pinned = addresses.find(item => isPublicIp(item.address)); if (!pinned) throw new TerminalOutboxDeliveryError('smtp_destination_rejected')
    const socket = tlsConnect({ host: this.smtp.hostname, port: Number(this.smtp.port || 465), servername: this.smtp.hostname, rejectUnauthorized: true, timeout: 10_000, lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family) })
    const read = smtpReader(socket)
    try {
      await onceConnect(socket, pinned.address); await read.expect(220); await smtpWrite(socket, `EHLO zhiji\r\n`); await read.expect(250)
      const user = decodeURIComponent(this.smtp.username); const password = decodeURIComponent(this.smtp.password)
      if (user && password) { await smtpWrite(socket, `AUTH PLAIN ${Buffer.from(`\u0000${user}\u0000${password}`).toString('base64')}\r\n`); await read.expect(235) }
      await smtpWrite(socket, `MAIL FROM:<${this.from}>\r\n`); await read.expect(250); await smtpWrite(socket, `RCPT TO:<${input.to}>\r\n`); await read.expect(250); await smtpWrite(socket, 'DATA\r\n'); await read.expect(354)
      const boundary = 'zhiji-boundary'; const subject = header(input.subject); const data = `From: <${this.from}>\r\nTo: <${input.to}>\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${dotStuff(input.text)}\r\n--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${dotStuff(input.html)}\r\n--${boundary}--\r\n.\r\n`
      await smtpWrite(socket, data); await read.expect(250); await smtpWrite(socket, 'QUIT\r\n')
    } finally { socket.destroy() }
  }
  async sendHttps(input: { url: URL; headers: Record<string, string>; body: string; allowedHosts: readonly string[] }): Promise<void> {
    if (!isAllowedHost(input.url.hostname, input.allowedHosts)) throw new TerminalOutboxDeliveryError('notification_egress_disabled')
    const addresses = await lookup(input.url.hostname, { all: true, verbatim: true }); const pinned = addresses.find(item => isPublicIp(item.address)); if (!pinned) throw new TerminalOutboxDeliveryError('notification_destination_rejected')
    await new Promise<void>((resolve, reject) => {
      // Node's https.request never follows redirects; a 3xx is terminal below.
      const request = httpsRequest({ protocol: 'https:', hostname: input.url.hostname, port: input.url.port || '443', path: `${input.url.pathname}${input.url.search}`, method: 'POST', headers: input.headers, timeout: 10_000, lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family), agent: false }, response => {
        let bytes = 0; response.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > 8192) response.destroy(new Error('notification_response_too_large')) }); response.on('error', reject); response.on('end', () => { if ((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300) resolve(); else if ((response.statusCode ?? 500) === 408 || (response.statusCode ?? 500) === 429 || (response.statusCode ?? 500) >= 500) reject(new Error('notification_remote_retryable')); else reject(new TerminalOutboxDeliveryError('notification_remote_rejected')) })
      })
      request.on('socket', socket => socket.once('secureConnect', () => { if (socket.remoteAddress !== pinned.address) request.destroy(new TerminalOutboxDeliveryError('notification_dns_pin_mismatch')) }))
      request.on('timeout', () => request.destroy(new Error('notification_timeout'))); request.on('error', reject); request.end(input.body)
    })
  }
}

function outboundAlert(value: AlertTarget, base: URL | null): Record<string, unknown> { const summary: Record<string, unknown> = {}; for (const [ key, item ] of Object.entries(value.summary)) if (SAFE_SUMMARY_KEYS.has(key) && safeSummaryValue(key, item)) summary[key] = item; const body: Record<string, unknown> = { version: 'zhiji-alert-v1', delivery_id: value.id, alert_instance_id: value.alert_instance_id, project: { id: value.project_id, name: cleanName(value.project_name) }, rule: { id: value.rule_id, name: cleanName(value.rule_name), type: value.rule_type }, status: value.status, triggered_at: value.triggered_at.toISOString(), summary }; if (base) { const url = new URL('/console/alerts', base); url.searchParams.set('project_id', value.project_id); url.searchParams.set('alert_instance_id', value.alert_instance_id); body.url = url.toString() } return body }
function outboundReport(value: ReportTarget, base: URL | null): Record<string, unknown> { const body: Record<string, unknown> = { version: 'zhiji-report-v1', delivery_id: value.id, report_run_id: value.report_run_id, schedule_id: value.schedule_id, project: { id: value.project_id, name: cleanName(value.project_name) }, scheduled_for: value.scheduled_for.toISOString() }; if (base) { const url = new URL('/console/reports', base); url.searchParams.set('project_id', value.project_id); url.searchParams.set('report_run_id', value.report_run_id); body.url = url.toString() } return body }
function validatedUrl(raw: string | undefined, type: NotificationType, allowlist: readonly string[]): URL { if (!raw) throw new TerminalOutboxDeliveryError('notification_destination_unconfigured'); let url: URL; try { url = new URL(raw) } catch { throw new TerminalOutboxDeliveryError('notification_destination_invalid') }; if (url.protocol !== 'https:' || url.username || url.password || url.hash || (type === 'lark_bot' && !isAllowedHost(url.hostname, [ 'open.feishu.cn' ])) || (type === 'webhook' && !isAllowedHost(url.hostname, allowlist))) throw new TerminalOutboxDeliveryError('notification_destination_rejected'); return url }
function isAllowedHost(host: string, allowed: readonly string[]): boolean { const normalized = host.toLowerCase().replace(/\.$/, ''); return allowed.some(entry => normalized === entry || normalized.endsWith(`.${entry}`)) }
function isPublicIp(address: string): boolean { if (isIP(address) === 4) { const [ a, b ] = address.split('.').map(Number); return a !== 0 && a !== 10 && a !== 127 && a !== 169 && !(a === 172 && b! >= 16 && b! <= 31) && !(a === 192 && b === 168) && !(a === 100 && b! >= 64 && b! <= 127) && a !== 224 && a !== 255 } const lower = address.toLowerCase(); return isIP(address) === 6 && lower !== '::1' && !lower.startsWith('fc') && !lower.startsWith('fd') && !lower.startsWith('fe8') && !lower.startsWith('fe9') && !lower.startsWith('fea') && !lower.startsWith('feb') }
function decryptInvitation(value: Record<string, unknown>, key: Buffer | null): { email: string; token: string } { if (!key) throw new TerminalOutboxDeliveryError('invitation_delivery_unavailable'); try { if (value.v !== 1 || value.alg !== 'A256GCM') throw new Error('invalid'); const iv = Buffer.from(stringField(value, 'iv'), 'base64url'); const tag = Buffer.from(stringField(value, 'tag'), 'base64url'); const ciphertext = Buffer.from(stringField(value, 'ciphertext'), 'base64url'); if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1) throw new Error('invalid'); const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag); const parsed: unknown = JSON.parse(Buffer.concat([ decipher.update(ciphertext), decipher.final() ]).toString('utf8')); const data = objectField(parsed); return { email: normalizedEmail(stringField(data, 'email')), token: token(stringField(data, 'token')) } } catch { throw new TerminalOutboxDeliveryError('invitation_delivery_invalid') } }
export function invitationKeyFromEnvironment(value: string | undefined): Buffer | null { if (!value) return null; try { const key = Buffer.from(value, 'base64url'); return key.length === 32 ? key : null } catch { return null } }
function safeSummaryValue(key: string, value: unknown): boolean { if ([ 'count', 'window_seconds', 'sample_count' ].includes(key)) return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; if (key === 'poor_ratio') return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; if (key === 'metric') return typeof value === 'string' && /^[A-Z]{2,10}$/.test(value); return key === 'release' && typeof value === 'string' && value.length > 0 && value.length <= 200 }
function pausesTarget(code: string): boolean { return [ 'notification_recipient_invalid', 'notification_signing_unavailable', 'notification_destination_unconfigured', 'notification_destination_invalid', 'notification_destination_rejected', 'notification_remote_rejected' ].includes(code) }
function cleanName(value: string): string { return value.replace(/[\r\n<>]/g, ' ').slice(0, 200) }
function alertText(value: Record<string, unknown>): string { return `知迹告警\n${JSON.stringify(value)}` }
function reportText(value: Record<string, unknown>): string { return `知迹报表已生成\n${JSON.stringify(value)}` }
function normalizedEmail(value: string): string { const email = value.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw new Error('invalid email'); return email }
function token(value: string): string { if (!/^[A-Za-z0-9_-]{32,512}$/.test(value)) throw new Error('invalid token'); return value }
function uuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function objectField(value: unknown, name?: string): Record<string, unknown> { const object = name ? (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[name] : undefined) : value; if (!object || typeof object !== 'object' || Array.isArray(object)) throw new TerminalOutboxDeliveryError('notification_payload_invalid'); return object as Record<string, unknown> }
function stringField(value: Record<string, unknown>, name: string): string { const item = value[name]; if (typeof item !== 'string' || item.length < 1 || item.length > 4096) throw new TerminalOutboxDeliveryError('notification_payload_invalid'); return item }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character)) }
function header(value: string): string { return value.replace(/[\r\n]/g, ' ').slice(0, 200) }
function dotStuff(value: string): string { return value.replace(/\r?\n/g, '\r\n').replace(/(^|\r\n)\./g, '$1..') }
function onceConnect(socket: import('node:tls').TLSSocket, pinnedAddress: string): Promise<void> { return new Promise((resolve, reject) => { socket.once('secureConnect', () => socket.remoteAddress === pinnedAddress ? resolve() : reject(new TerminalOutboxDeliveryError('smtp_dns_pin_mismatch'))); socket.once('error', reject); socket.once('timeout', () => reject(new Error('smtp_timeout'))) }) }
function smtpWrite(socket: import('node:tls').TLSSocket, value: string): Promise<void> { return new Promise((resolve, reject) => socket.write(value, error => error ? reject(error) : resolve())) }
function smtpReader(socket: import('node:tls').TLSSocket): { expect(code: number): Promise<void> } { let buffer = ''; const lines: string[] = []; socket.on('data', chunk => { buffer += chunk.toString('utf8'); let end: number; while ((end = buffer.indexOf('\r\n')) >= 0) { lines.push(buffer.slice(0, end)); buffer = buffer.slice(end + 2) } }); return { expect: async code => { const deadline = Date.now() + 10_000; while (Date.now() < deadline) { const line = lines.shift(); if (line) { if (new RegExp(`^${code}(?: |-)`).test(line)) { if (line.startsWith(`${code}-`)) continue; return } throw new TerminalOutboxDeliveryError('smtp_remote_rejected') } await new Promise(resolve => setTimeout(resolve, 10)) } throw new Error('smtp_timeout') } } }
