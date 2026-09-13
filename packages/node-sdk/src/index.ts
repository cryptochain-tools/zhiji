import { randomUUID } from 'node:crypto'

export interface NodeRequestContext { visitorId: string; businessUserId?: string }
export interface NodeTrackInput extends NodeRequestContext { name: string; properties?: Record<string, string | number | boolean | readonly string[]>; clientEventId?: string; occurredAt?: Date }
export interface NodeErrorInput extends NodeRequestContext { error: unknown; clientEventId?: string; occurredAt?: Date; release?: string }
export interface NodeLoginInput extends NodeRequestContext { identityAssertion: string; traits?: Record<string, string | number | boolean | readonly string[]>; clientEventId?: string; occurredAt?: Date }
export interface NodeFlushResult { attempted: number; accepted: number; duplicate: number; dropped: number; pending: number }
export interface NodeFlushOptions { timeoutMs?: number }
export interface NodeFetchResponse { ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown> }
export type NodeFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<NodeFetchResponse>
export interface ZhijiNodeOptions {
  key: string
  analyticsEndpoint?: string
  errorEndpoint?: string
  release?: string
  fetch?: NodeFetch
  maxQueueItems?: number
}

type AnalyticsWire = { client_event_id: string; client_instance_id: string; client_sequence: number; kind: 'event' | 'login'; visitor_id: string; business_user_id?: string; occurred_at: string; release?: string; name?: string; properties?: Record<string, unknown>; identity_assertion?: string; traits?: Record<string, unknown> }
type ErrorWire = { client_event_id: string; kind: 'error'; visitor_id: string; business_user_id?: string; occurred_at: string; release?: string; error: { mechanism: 'manual'; type: string; message: string; stack?: string } }
type QueueItem<T> = { value: T; bytes: number; retries: number }
type LaneState<T> = { queue: QueueItem<T>[]; bytes: number; timer?: ReturnType<typeof setTimeout>; retryTimer?: ReturnType<typeof setTimeout>; sending: boolean }

const MAX_QUEUE_BYTES = 512 * 1024
const MAX_BATCH_ITEMS = 50
const FLUSH_AT = 20
const FLUSH_INTERVAL_MS = 1_000
const MAX_RETRIES = 3

/**
 * In-memory server SDK. Context is passed per call, so concurrent requests
 * cannot leak a business-user identity into another request. It never writes
 * telemetry to disk and never captures request headers, bodies or URLs.
 */
export class ZhijiNodeClient {
  private readonly instanceId = randomUUID()
  private readonly analytics: LaneState<AnalyticsWire> = { queue: [], bytes: 0, sending: false }
  private readonly errors: LaneState<ErrorWire> = { queue: [], bytes: 0, sending: false }
  private sequence = 0
  private readonly options: Required<Pick<ZhijiNodeOptions, 'analyticsEndpoint' | 'errorEndpoint' | 'maxQueueItems'>> & ZhijiNodeOptions

  constructor(options: ZhijiNodeOptions) {
    if (!validText(options.key, 8, 512)) throw new Error('Zhiji Node SDK requires a server key')
    if (!options.fetch && typeof globalThis.fetch !== 'function') throw new Error('A fetch implementation is required')
    if (!Number.isSafeInteger(options.maxQueueItems ?? 100) || (options.maxQueueItems ?? 100) < 1 || (options.maxQueueItems ?? 100) > 10_000) throw new Error('maxQueueItems must be between 1 and 10000')
    this.options = { analyticsEndpoint: '/api/ingest/server/events', errorEndpoint: '/api/ingest/server/errors', maxQueueItems: 100, ...options }
  }

  capture(input: NodeTrackInput): void {
    if (!validName(input.name) || !validContext(input)) return
    this.enqueue(this.analytics, { ...this.base('event', input), name: input.name, ...(input.properties ? { properties: safeProperties(input.properties) } : {}) })
  }

  captureException(input: NodeErrorInput): void {
    if (!validContext(input)) return
    const error = normalizeError(input.error)
    this.enqueue(this.errors, { client_event_id: input.clientEventId ?? randomUUID(), kind: 'error', visitor_id: input.visitorId, ...(input.businessUserId ? { business_user_id: input.businessUserId } : {}), occurred_at: (input.occurredAt ?? new Date()).toISOString(), ...(release(input.release ?? this.options.release) ? { release: release(input.release ?? this.options.release) } : {}), error })
  }

  login(input: NodeLoginInput): void {
    if (!validContext(input) || !validText(input.identityAssertion, 1, 4096)) return
    this.enqueue(this.analytics, { ...this.base('login', input), business_user_id: input.businessUserId!, identity_assertion: input.identityAssertion, ...(input.traits ? { traits: safeProperties(input.traits) } : {}) })
  }

  logout(): void { /* Context is request-scoped; this method is intentionally a no-op for API symmetry. */ }

  async flush(options: NodeFlushOptions = {}): Promise<{ analytics: NodeFlushResult; error: NodeFlushResult }> {
    const timeoutMs = options.timeoutMs
    if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)) throw new Error('flush timeout must be between 1 and 30000 ms')
    const work = Promise.all([this.send(this.analytics, this.options.analyticsEndpoint), this.send(this.errors, this.options.errorEndpoint)]).then(([analytics, error]) => ({ analytics, error }))
    if (timeoutMs === undefined) return await work
    return await Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Zhiji flush timed out')), timeoutMs))])
  }

  async shutdown(timeoutMs = 2_000): Promise<{ analytics: NodeFlushResult; error: NodeFlushResult }> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error('shutdown timeout must be between 1 and 30000 ms')
    return await this.flush({ timeoutMs })
  }

  private base(kind: 'event' | 'login', input: NodeTrackInput | NodeLoginInput): AnalyticsWire {
    return { client_event_id: input.clientEventId ?? randomUUID(), client_instance_id: this.instanceId, client_sequence: this.sequence++, kind, visitor_id: input.visitorId, ...(input.businessUserId ? { business_user_id: input.businessUserId } : {}), occurred_at: (input.occurredAt ?? new Date()).toISOString(), ...(release(this.options.release) ? { release: release(this.options.release) } : {}) }
  }

  private enqueue<T>(lane: LaneState<T>, value: T): void {
    const bytes = byteLength(value)
    if (bytes > MAX_QUEUE_BYTES) return
    while (lane.queue.length >= this.options.maxQueueItems || lane.bytes + bytes > MAX_QUEUE_BYTES) {
      const dropped = lane.queue.shift()
      if (!dropped) break
      lane.bytes -= dropped.bytes
    }
    lane.queue.push({ value, bytes, retries: 0 })
    lane.bytes += bytes
    if (lane.queue.length >= FLUSH_AT) void this.send(lane, lane === this.analytics ? this.options.analyticsEndpoint : this.options.errorEndpoint)
    else this.armFlush(lane, lane === this.analytics ? this.options.analyticsEndpoint : this.options.errorEndpoint)
  }

  private async send<T>(lane: LaneState<T>, endpoint: string): Promise<NodeFlushResult> {
    if (lane.sending || lane.queue.length === 0) return this.result(lane)
    this.clearFlush(lane)
    lane.sending = true
    const batch = lane.queue.splice(0, Math.min(lane.queue.length, MAX_BATCH_ITEMS))
    lane.bytes -= batch.reduce((total, item) => total + item.bytes, 0)
    const result: NodeFlushResult = { attempted: batch.length, accepted: 0, duplicate: 0, dropped: 0, pending: lane.queue.length }
    try {
      const response = await (this.options.fetch ?? globalThis.fetch as unknown as NodeFetch)(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-zhiji-key': this.options.key }, body: JSON.stringify({ key: this.options.key, events: batch.map(item => item.value) }) })
      if (!response.ok) {
        if (response.status === 408 || response.status === 429 || response.status >= 500) this.retry(lane, batch, retryAfterMs(response.headers?.get('Retry-After') ?? null))
        else result.dropped = batch.length
        return { ...result, pending: lane.queue.length }
      }
      const payload = await response.json() as { data?: { accepted?: unknown; duplicate?: unknown; dropped?: unknown } }
      result.accepted = count(payload.data?.accepted); result.duplicate = count(payload.data?.duplicate); result.dropped = count(payload.data?.dropped)
      return { ...result, pending: lane.queue.length }
    } catch {
      this.retry(lane, batch, undefined)
      return { ...result, pending: lane.queue.length }
    } finally {
      lane.sending = false
      if (lane.queue.length > 0 && !lane.retryTimer) this.armFlush(lane, endpoint)
    }
  }

  private retry<T>(lane: LaneState<T>, batch: QueueItem<T>[], retryAfter: number | undefined): void {
    const retryable = batch.filter(item => item.retries < MAX_RETRIES)
    let requeued = 0
    for (const item of retryable.reverse()) {
      while (lane.queue.length >= this.options.maxQueueItems || lane.bytes + item.bytes > MAX_QUEUE_BYTES) {
        const evicted = lane.queue.pop()
        if (!evicted) break
        lane.bytes -= evicted.bytes
      }
      if (lane.queue.length >= this.options.maxQueueItems || lane.bytes + item.bytes > MAX_QUEUE_BYTES) continue
      item.retries += 1
      lane.queue.unshift(item)
      lane.bytes += item.bytes
      requeued += 1
    }
    if (!requeued || lane.retryTimer) return
    const delay = retryAfter ?? backoffMs(retryable[0]!.retries)
    lane.retryTimer = setTimeout(() => {
      lane.retryTimer = undefined
      void this.send(lane, lane === this.analytics ? this.options.analyticsEndpoint : this.options.errorEndpoint)
    }, delay)
  }

  private armFlush<T>(lane: LaneState<T>, endpoint: string): void {
    if (lane.timer || lane.retryTimer) return
    lane.timer = setTimeout(() => { lane.timer = undefined; void this.send(lane, endpoint) }, FLUSH_INTERVAL_MS)
  }
  private clearFlush<T>(lane: LaneState<T>): void { if (lane.timer) clearTimeout(lane.timer); lane.timer = undefined }
  private result<T>(lane: LaneState<T>): NodeFlushResult { return { attempted: 0, accepted: 0, duplicate: 0, dropped: 0, pending: lane.queue.length } }
}

function validText(value: unknown, min: number, max: number): value is string { return typeof value === 'string' && value.trim() === value && value.length >= min && value.length <= max }
function validName(value: string): boolean { return /^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/.test(value) }
function validContext(value: NodeRequestContext): boolean { return validText(value.visitorId, 1, 128) && (value.businessUserId === undefined || validText(value.businessUserId, 1, 128)) }
function safeProperties(input: Record<string, string | number | boolean | readonly string[]>): Record<string, string | number | boolean | string[]> { const output: Record<string, string | number | boolean | string[]> = {}; for (const [key, value] of Object.entries(input)) { if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(key) || /(?:password|token|secret|cookie|authorization|email|phone)/i.test(key)) continue; if (typeof value === 'string' && value.length <= 512) output[key] = value; else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value; else if (typeof value === 'boolean') output[key] = value; else if (Array.isArray(value) && value.length <= 20 && value.every(item => typeof item === 'string' && item.length <= 128)) output[key] = [...value] } return output }
function normalizeError(value: unknown): ErrorWire['error'] { if (value instanceof Error) return { mechanism: 'manual', type: (value.name || 'Error').slice(0, 128), message: redact(value.message, 2048), ...(value.stack ? { stack: redact(value.stack, 12_000) } : {}) }; return { mechanism: 'manual', type: 'UnknownError', message: 'Non-Error exception' } }
function redact(value: string, max: number): string { return value.replace(/([?&](?:token|password|authorization|cookie|session)=[^\s&#]+)/gi, '$1=[redacted]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]').slice(0, max) }
function release(value: unknown): string | undefined { return validText(value, 1, 200) ? value : undefined }
function count(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0 }
function byteLength(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength }
function backoffMs(retry: number): number { return Math.min(10_000, 500 * 2 ** Math.max(0, retry - 1)) + Math.floor(Math.random() * 250) }
function retryAfterMs(value: string | null): number | undefined { if (!value) return undefined; const seconds = Number(value); if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 60_000); const date = Date.parse(value); return Number.isFinite(date) ? Math.min(Math.max(0, date - Date.now()), 60_000) : undefined }
