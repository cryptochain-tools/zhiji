/**
 * React Native-friendly Zhiji SDK. It deliberately has no React Native import:
 * applications provide `fetch`, and may optionally provide an AsyncStorage- or
 * secure-storage-compatible visitor store.
 *
 * Mobile keys are public app identifiers, never credentials. Transport uses
 * registered app declaration headers and HTTPS by default.
 */
export const MOBILE_INGEST_ENDPOINTS = {
  events: '/api/ingest/mobile/events',
  errors: '/api/ingest/mobile/errors',
} as const

export const MOBILE_INGEST_HEADERS = {
  key: 'X-Zhiji-Key',
  platform: 'X-Zhiji-Mobile-Platform',
  applicationId: 'X-Zhiji-App-Id',
  applicationVersion: 'X-Zhiji-App-Version',
} as const

export type MobilePlatform = 'ios' | 'android' | 'react_native'
export type MobileAppState = 'active' | 'background' | 'inactive'
export type MobileProperty = string | number | boolean | readonly string[]

export interface MobileDeclaration {
  platform: MobilePlatform
  applicationId: string
  applicationVersion: string
}

/** The body is the server's standard `{ key, events }` envelope. */
export interface MobileIngestEnvelope<Event extends Record<string, unknown>> {
  key: string
  events: readonly Event[]
}

/** Minimal AsyncStorage/SecureStore compatible port. Telemetry is never stored through it. */
export interface MobileVisitorStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export interface MobileFetchResponse {
  ok: boolean
  status: number
  headers?: { get(name: string): string | null }
  json(): Promise<unknown>
}

export type MobileFetch = (url: string, init: {
  method: 'POST'
  headers: Record<string, string>
  body: string
}) => Promise<MobileFetchResponse>

export interface ZhijiMobileOptions extends MobileDeclaration {
  /** A full HTTPS API origin, e.g. `https://telemetry.example.com`. */
  endpointBaseUrl: string
  /** Public mobile project key, registered for this app declaration. */
  key: string
  release?: string
  fetch?: MobileFetch
  visitorStorage?: MobileVisitorStorage
  visitorStorageKey?: string
  maxQueueItems?: number
  /** Development-only escape hatch for an HTTP localhost endpoint. */
  allowInsecureTransport?: boolean
  debug?: boolean
}

export interface MobileTrackOptions {
  clientEventId?: string
  occurredAt?: Date
}

export interface MobileErrorOptions extends MobileTrackOptions {
  dist?: string
}

export interface MobilePerformanceInput extends MobileTrackOptions {
  name: string
  value: number
  unit?: 'ms' | 'bytes' | 'count' | 'ratio'
  attributes?: Record<string, MobileProperty>
}

export interface MobileFlushResult {
  attempted: number
  accepted: number
  duplicate: number
  sampled: number
  rateLimited: number
  dropped: number
  pending: number
}

export interface MobileFlushResults {
  analytics: MobileFlushResult
  error: MobileFlushResult
}

type AnalyticsWire = {
  client_event_id: string
  client_instance_id: string
  client_sequence: number
  kind: 'event' | 'login'
  visitor_id: string
  business_user_id?: string
  occurred_at: string
  release?: string
  name?: string
  properties?: Record<string, MobileProperty>
  identity_assertion?: string
  traits?: Record<string, MobileProperty>
}
type ErrorWire = {
  client_event_id: string
  kind: 'error'
  visitor_id: string
  business_user_id?: string
  occurred_at: string
  release?: string
  dist?: string
  error: { mechanism: 'manual'; type: string; message: string; stack?: string }
}
type QueueItem<T> = { value: T; bytes: number; retries: number }
type Lane<T> = { queue: QueueItem<T>[]; bytes: number; sending: boolean; timer?: ReturnType<typeof setTimeout>; retryTimer?: ReturnType<typeof setTimeout> }

const MAX_BATCH_ITEMS = 50
const MAX_QUEUE_BYTES = 240 * 1024
const DEFAULT_MAX_QUEUE_ITEMS = 500
const FLUSH_AT = 20
const FLUSH_INTERVAL_MS = 1_000
const MAX_RETRIES = 3
const VISITOR_STORAGE_KEY = 'zhiji.mobile.visitor_id.v1'
const SENSITIVE_KEY = /(?:password|token|secret|cookie|authorization|email|phone|address|body|clipboard|notification)/i
const RESERVED_KEY = /^(?:__proto__|prototype|constructor|name)$/i

/**
 * In-memory mobile client. Payloads are deliberately not persisted: React
 * Native background execution is not reliable, and writing telemetry to an
 * unverified store could expose private app data. Persist only a random
 * anonymous visitor identifier via an application-provided protected store.
 */
export class ZhijiMobileClient {
  private readonly instanceId = randomUuid()
  private visitorId = randomUuid()
  private readonly analytics: Lane<AnalyticsWire> = { queue: [], bytes: 0, sending: false }
  private readonly errors: Lane<ErrorWire> = { queue: [], bytes: 0, sending: false }
  private readonly options: Required<Pick<ZhijiMobileOptions, 'maxQueueItems' | 'visitorStorageKey'>> & ZhijiMobileOptions
  private businessUserId: string | undefined
  private sequence = 0
  private closed = false
  private readonly readyPromise: Promise<void>

  constructor(options: ZhijiMobileOptions) {
    if (!validText(options.key, 8, 512)) throw new Error('Zhiji mobile SDK requires a mobile project key')
    if (!validDeclaration(options)) throw new Error('A registered mobile platform, applicationId, and applicationVersion are required')
    if (!Number.isSafeInteger(options.maxQueueItems ?? DEFAULT_MAX_QUEUE_ITEMS) || (options.maxQueueItems ?? DEFAULT_MAX_QUEUE_ITEMS) < 1 || (options.maxQueueItems ?? DEFAULT_MAX_QUEUE_ITEMS) > 10_000) throw new Error('maxQueueItems must be between 1 and 10000')
    const baseUrl = normalizeBaseUrl(options.endpointBaseUrl, options.allowInsecureTransport === true)
    if (!options.fetch && typeof globalThis.fetch !== 'function') throw new Error('A fetch implementation is required')
    this.options = { ...options, endpointBaseUrl: baseUrl, maxQueueItems: options.maxQueueItems ?? DEFAULT_MAX_QUEUE_ITEMS, visitorStorageKey: options.visitorStorageKey ?? VISITOR_STORAGE_KEY }
    this.readyPromise = this.restoreVisitor()
  }

  /** Await before first telemetry when an existing anonymous identity must be restored. */
  ready(): Promise<void> { return this.readyPromise }

  getVisitorId(): string { return this.visitorId }

  track(name: string, properties?: Record<string, MobileProperty>, options?: MobileTrackOptions): void {
    if (this.closed || !validEventName(name)) return this.debug('analytics', 'invalid_event_name')
    this.enqueue(this.analytics, this.analyticsEvent('event', options, {
      name,
      ...(properties ? { properties: safeProperties(properties) } : {}),
    }), 'analytics')
  }

  /**
   * Sends a verified login association before applying it to later events.
   * The identity assertion is never written to storage or debug output.
   */
  async login(businessUserId: string, identityAssertion: string, traits?: Record<string, MobileProperty>): Promise<boolean> {
    if (this.closed || !validIdentifier(businessUserId) || !validText(identityAssertion, 1, 4096)) {
      this.debug('analytics', 'invalid_login')
      return false
    }
    await this.ready()
    await this.flushLane(this.analytics, 'analytics')
    const normalized = businessUserId.trim()
    this.enqueue(this.analytics, this.analyticsEvent('login', undefined, {
      business_user_id: normalized,
      identity_assertion: identityAssertion,
      ...(traits ? { traits: safeProperties(traits) } : {}),
    }, false), 'analytics')
    const result = await this.flushLane(this.analytics, 'analytics')
    if (result.accepted + result.duplicate < 1) return false
    this.businessUserId = normalized
    return true
  }

  /** Keeps the anonymous visitor ID so post-logout activity remains attributable to this app installation. */
  logout(): void { this.businessUserId = undefined }

  captureException(error: unknown, options?: MobileErrorOptions): void {
    if (this.closed) return
    const normalized = normalizeError(error)
    this.enqueue(this.errors, {
      client_event_id: options?.clientEventId ?? randomUuid(),
      kind: 'error', visitor_id: this.visitorId,
      ...(this.businessUserId ? { business_user_id: this.businessUserId } : {}),
      occurred_at: (options?.occurredAt ?? new Date()).toISOString(),
      ...(release(this.options.release) ? { release: release(this.options.release) } : {}),
      ...(release(options?.dist) ? { dist: release(options?.dist) } : {}), error: normalized,
    }, 'error')
  }

  /** Alias for applications that expose an `error` telemetry method. */
  captureError(error: unknown, options?: MobileErrorOptions): void { this.captureException(error, options) }

  /**
   * Mobile ingestion has no performance lane. This emits a bounded analytics
   * event named `mobile_performance`, preserving the same queue, receipts and
   * mobile declaration checks without pretending a browser Web Vitals endpoint exists.
   */
  capturePerformance(input: MobilePerformanceInput): void {
    if (this.closed || !validEventName(input.name) || !Number.isFinite(input.value) || input.value < 0 || input.value > 600_000) {
      this.debug('analytics', 'invalid_performance')
      return
    }
    this.track('mobile_performance', {
      metric_name: input.name,
      metric_value: input.value,
      ...(input.unit ? { metric_unit: input.unit } : {}),
      ...(input.attributes ? safeProperties(input.attributes) : {}),
    }, input)
  }

  /** Call from React Native AppState change handlers; background delivery is best effort. */
  appState(state: MobileAppState): void {
    if (!this.closed && (state === 'background' || state === 'inactive')) void this.flush()
  }

  async flush(): Promise<MobileFlushResults> {
    await this.ready()
    const [analytics, error] = await Promise.all([this.flushLane(this.analytics, 'analytics'), this.flushLane(this.errors, 'error')])
    return { analytics, error }
  }

  async shutdown(): Promise<MobileFlushResults> {
    const result = await this.flush()
    this.closed = true
    this.clearLane(this.analytics)
    this.clearLane(this.errors)
    return result
  }

  private analyticsEvent(kind: 'event' | 'login', options: MobileTrackOptions | undefined, fields: Omit<AnalyticsWire, 'client_event_id' | 'client_instance_id' | 'client_sequence' | 'kind' | 'visitor_id' | 'occurred_at' | 'release'>, includeCurrentUser = true): AnalyticsWire {
    return {
      client_event_id: options?.clientEventId ?? randomUuid(), client_instance_id: this.instanceId, client_sequence: this.sequence++, kind,
      visitor_id: this.visitorId, ...(includeCurrentUser && this.businessUserId ? { business_user_id: this.businessUserId } : {}),
      occurred_at: (options?.occurredAt ?? new Date()).toISOString(), ...(release(this.options.release) ? { release: release(this.options.release) } : {}), ...fields,
    }
  }

  private enqueue<T>(lane: Lane<T>, value: T, laneName: 'analytics' | 'error'): void {
    const bytes = byteLength(value)
    if (bytes > MAX_QUEUE_BYTES) return this.debug(laneName, 'event_too_large')
    while (lane.queue.length >= this.options.maxQueueItems || lane.bytes + bytes > MAX_QUEUE_BYTES) {
      const dropped = lane.queue.shift()
      if (!dropped) break
      lane.bytes -= dropped.bytes
    }
    lane.queue.push({ value, bytes, retries: 0 }); lane.bytes += bytes
    if (lane.queue.length >= FLUSH_AT) void this.flushLane(lane, laneName)
    else this.armFlush(lane, laneName)
  }

  private async flushLane<T>(lane: Lane<T>, laneName: 'analytics' | 'error'): Promise<MobileFlushResult> {
    if (lane.sending || lane.queue.length === 0) return result(lane)
    this.clearTimer(lane); lane.sending = true
    const batch = lane.queue.splice(0, MAX_BATCH_ITEMS)
    lane.bytes -= batch.reduce((total, item) => total + item.bytes, 0)
    const output: MobileFlushResult = { attempted: batch.length, accepted: 0, duplicate: 0, sampled: 0, rateLimited: 0, dropped: 0, pending: lane.queue.length }
    try {
      const response = await (this.options.fetch ?? (globalThis.fetch as unknown as MobileFetch))(this.endpoint(laneName), {
        method: 'POST', headers: this.headers(), body: JSON.stringify({ key: this.options.key, events: batch.map(item => item.value) }),
      })
      if (!response.ok) {
        if (retryableStatus(response.status)) this.retry(lane, batch, laneName, retryAfterMs(response.headers?.get('Retry-After') ?? null))
        else output.dropped = batch.length
        this.debug(laneName, `http_${response.status}`)
        return { ...output, pending: lane.queue.length }
      }
      const payload = await response.json() as { data?: Record<string, unknown> }
      output.accepted = count(payload.data?.accepted); output.duplicate = count(payload.data?.duplicate)
      output.sampled = count(payload.data?.sampled); output.rateLimited = count(payload.data?.rate_limited); output.dropped = count(payload.data?.dropped)
      return { ...output, pending: lane.queue.length }
    } catch {
      this.retry(lane, batch, laneName)
      this.debug(laneName, 'network_failure')
      return { ...output, pending: lane.queue.length }
    } finally {
      lane.sending = false
      if (lane.queue.length > 0 && !lane.retryTimer && !this.closed) this.armFlush(lane, laneName)
    }
  }

  private retry<T>(lane: Lane<T>, batch: QueueItem<T>[], laneName: 'analytics' | 'error', retryAfter?: number): void {
    const retryable = batch.filter(item => item.retries < MAX_RETRIES)
    for (const item of retryable.reverse()) {
      if (lane.queue.length >= this.options.maxQueueItems || lane.bytes + item.bytes > MAX_QUEUE_BYTES) continue
      item.retries += 1; lane.queue.unshift(item); lane.bytes += item.bytes
    }
    if (!retryable.length || lane.retryTimer || this.closed) return
    lane.retryTimer = setTimeout(() => { lane.retryTimer = undefined; void this.flushLane(lane, laneName) }, retryAfter ?? backoffMs(retryable[0]!.retries))
  }

  private armFlush<T>(lane: Lane<T>, laneName: 'analytics' | 'error'): void {
    if (lane.timer || lane.retryTimer || this.closed) return
    lane.timer = setTimeout(() => { lane.timer = undefined; void this.flushLane(lane, laneName) }, FLUSH_INTERVAL_MS)
  }
  private clearTimer<T>(lane: Lane<T>): void { if (lane.timer) clearTimeout(lane.timer); lane.timer = undefined }
  private clearLane<T>(lane: Lane<T>): void { this.clearTimer(lane); if (lane.retryTimer) clearTimeout(lane.retryTimer); lane.retryTimer = undefined }
  private endpoint(lane: 'analytics' | 'error'): string { return `${this.options.endpointBaseUrl}${lane === 'analytics' ? MOBILE_INGEST_ENDPOINTS.events : MOBILE_INGEST_ENDPOINTS.errors}` }
  private headers(): Record<string, string> { return { 'content-type': 'application/json', [MOBILE_INGEST_HEADERS.key]: this.options.key, [MOBILE_INGEST_HEADERS.platform]: this.options.platform, [MOBILE_INGEST_HEADERS.applicationId]: this.options.applicationId, [MOBILE_INGEST_HEADERS.applicationVersion]: this.options.applicationVersion } }
  private debug(lane: 'analytics' | 'error', reason: string): void { if (this.options.debug && typeof console !== 'undefined') console.debug('[Zhiji Mobile]', { lane, reason }) }

  private async restoreVisitor(): Promise<void> {
    const store = this.options?.visitorStorage
    if (!store) return
    try {
      const stored = await store.getItem(this.options.visitorStorageKey)
      if (stored && validUuid(stored) && this.sequence === 0 && this.analytics.queue.length === 0 && this.errors.queue.length === 0) { this.visitorId = stored; return }
      await store.setItem(this.options.visitorStorageKey, this.visitorId)
    } catch { this.debug('analytics', 'visitor_storage_unavailable') }
  }
}

/** Native app metadata is declarative until server-side attestation is installed. */
export const MOBILE_VERIFICATION_LEVEL = 'declaration_only' as const

function validDeclaration(value: MobileDeclaration): boolean { return (value.platform === 'ios' || value.platform === 'android' || value.platform === 'react_native') && /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(value.applicationId) && /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(value.applicationVersion) && value.applicationVersion.length <= 64 }
function normalizeBaseUrl(value: string, allowInsecure: boolean): string { let url: URL; try { url = new URL(value) } catch { throw new Error('endpointBaseUrl must be an absolute URL') }; if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) throw new Error('endpointBaseUrl must use HTTPS unless allowInsecureTransport is enabled'); if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('endpointBaseUrl must be an origin without credentials, path, query, or hash'); return url.origin }
function validText(value: unknown, min: number, max: number): value is string { return typeof value === 'string' && value.trim() === value && value.length >= min && value.length <= max }
function validIdentifier(value: unknown): value is string { return validText(value, 1, 128) }
function validEventName(value: string): boolean { return /^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/.test(value) }
function release(value: unknown): string | undefined { return validText(value, 1, 200) ? value : undefined }
function safeProperties(input: Record<string, MobileProperty>): Record<string, MobileProperty> { const output: Record<string, MobileProperty> = {}; for (const [key, value] of Object.entries(input)) { if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(key) || SENSITIVE_KEY.test(key) || RESERVED_KEY.test(key)) continue; if (typeof value === 'string' && value.length <= 512) output[key] = value; else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value; else if (typeof value === 'boolean') output[key] = value; else if (Array.isArray(value) && value.length <= 20 && value.every(item => typeof item === 'string' && item.length <= 128)) output[key] = [...value] } return output }
function normalizeError(value: unknown): ErrorWire['error'] { if (value instanceof Error) return { mechanism: 'manual', type: (value.name || 'Error').slice(0, 128), message: redact(value.message, 2048), ...(value.stack ? { stack: redact(value.stack, 12 * 1024) } : {}) }; if (typeof value === 'string' || typeof value === 'number') return { mechanism: 'manual', type: 'UnknownError', message: redact(String(value), 2048) }; return { mechanism: 'manual', type: 'UnknownError', message: 'Non-Error exception' } }
function redact(value: string, max: number): string { return value.replace(/([?&](?:token|password|authorization|cookie|session)=[^\s&#]+)/gi, '$1=[redacted]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]').slice(0, max) }
function byteLength(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength }
function count(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0 }
function result<T>(lane: Lane<T>): MobileFlushResult { return { attempted: 0, accepted: 0, duplicate: 0, sampled: 0, rateLimited: 0, dropped: 0, pending: lane.queue.length } }
function retryableStatus(status: number): boolean { return status === 408 || status === 429 || status >= 500 }
function retryAfterMs(value: string | null): number | undefined { if (!value) return undefined; const seconds = Number(value); if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 60_000); const date = Date.parse(value); return Number.isFinite(date) ? Math.min(Math.max(0, date - Date.now()), 60_000) : undefined }
function backoffMs(retry: number): number { return Math.min(10_000, 500 * 2 ** Math.max(0, retry - 1)) + Math.floor(Math.random() * 250) }
function randomUuid(): string { if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID(); const bytes = new Uint8Array(16); if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes); else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256); bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80; return [...bytes].map((byte, index) => `${byte.toString(16).padStart(2, '0')}${[3, 5, 7, 9].includes(index) ? '-' : ''}`).join('') }
function validUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
