import {
  AnalyticsEvent,
  BehaviorEvent,
  ErrorEvent,
  IngestCounts,
  IngestLane,
  IngestScope,
  IngestValidationOptions,
  JsonValue,
  LoginEvent,
  PageKeyPolicy,
  PerformanceEvent,
  ReceiptKey,
  ReceiptStore,
  ReplayRequest,
} from '../../contracts/ingest'
import { ReplayPayloadError, validateSanitizedReplayChunk } from '../replay/sanitize'
import { normalizeErrorFrame } from '../sourcemaps/resolution'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/i
const RESERVED_OR_SENSITIVE_KEY = /^(?:__proto__|prototype|constructor|cookie|authorization|password|token|secret|session|body|html|selector|class|aria(?:[_-]?label)?|email|phone|name|address)$/i
const DISALLOWED_TEXT = /(?:bearer\s+|(?:api[_-]?key|token|password|secret)\s*[:=])/i

export class IngestContractError extends Error {
  constructor(readonly code: string, readonly eventIndex?: number, readonly field?: string) {
    super(code)
  }
}

export type ValidatedIngest =
  | { lane: 'analytics'; key: string; events: Array<AnalyticsEvent | LoginEvent> }
  | { lane: 'error'; key: string; events: ErrorEvent[] }
  | { lane: 'behavior'; key: string; events: BehaviorEvent[] }
  | { lane: 'performance'; key: string; events: PerformanceEvent[] }
  | { lane: 'replay'; request: ReplayRequest }

export function sanitizePageKey(input: unknown, policy: PageKeyPolicy): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 512 || /[?#@]/.test(input)) return null
  const value = input.trim()
  if (value !== input || !value.startsWith('/') || value.includes('//')) return null
  if (policy.allowedPageKeys.includes(value)) return value
  for (const template of policy.routeTemplates) {
    if (!isSafeTemplate(template)) continue
    const pattern = '^' + template.split('/').map(segment => {
      if (segment === '') return ''
      return segment.startsWith(':') ? '[^/]+' : escapeRegex(segment)
    }).join('/') + '$'
    if (new RegExp(pattern).test(value)) return template
  }
  return null
}

export function validateIngest(lane: IngestLane, body: unknown, options: IngestValidationOptions): ValidatedIngest {
  if (lane === 'replay') return { lane, request: validateReplay(body, options) }
  const envelope = exactObject(body, ['key', 'events'])
  const key = boundedString(envelope.key, 'key', 1, 512)
  if (!Array.isArray(envelope.events) || envelope.events.length === 0 || envelope.events.length > 50) throw invalid('events')
  const events = envelope.events.map((event, index) => validateEvent(lane, event, index, options))
  return { lane, key, events } as ValidatedIngest
}

export async function claimReceipts(
  store: ReceiptStore,
  scope: IngestScope,
  lane: IngestLane,
  clientEventIds: readonly string[],
): Promise<IngestCounts> {
  const counts: IngestCounts = { accepted: 0, duplicate: 0, sampled: 0, rate_limited: 0, dropped: 0 }
  for (const clientEventId of clientEventIds) {
    const key: ReceiptKey = { ...scope, lane, clientEventId }
    if (await store.claim(key)) counts.accepted += 1
    else counts.duplicate += 1
  }
  return counts
}

function validateEvent(lane: Exclude<IngestLane, 'replay'>, value: unknown, index: number, options: IngestValidationOptions) {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid('event', index)
  const receivedKind = value.kind
  const expected = lane === 'analytics' ? ['event', 'login'] : [lane]
  if (typeof receivedKind === 'string' && ['event', 'login', 'error', 'behavior', 'performance'].includes(receivedKind) && !expected.includes(receivedKind)) {
    throw new IngestContractError('invalid_ingest_lane', index, 'kind')
  }
  const base = exactObject(value, allowedFields(lane, value))
  const kind = requiredEnum(base.kind, ['event', 'login', 'error', 'behavior', 'performance'] as const, index, 'kind')
  if (!expected.includes(kind)) throw new IngestContractError('invalid_ingest_lane', index, 'kind')
  const common = validateCommon(base, index, options)
  switch (kind) {
    case 'event': return validateAnalyticsEvent(base, common, index, options.pagePolicy)
    case 'login': return validateLogin(base, common, index)
    case 'error': return validateError(base, common, index, options.pagePolicy)
    case 'behavior': return validateBehavior(base, common, index, options.pagePolicy)
    case 'performance': return validatePerformance(base, common, index, options.pagePolicy)
  }
}

function validateCommon(value: Record<string, unknown>, index: number, options: IngestValidationOptions) {
  const clientEventId = uuid(value.client_event_id, index, 'client_event_id')
  const visitorId = identifier(value.visitor_id, index, 'visitor_id')
  const occurredAt = timestamp(value.occurred_at, index, options)
  return { client_event_id: clientEventId, visitor_id: visitorId, occurred_at: occurredAt }
}

function validateAnalyticsEvent(value: Record<string, unknown>, common: ReturnType<typeof validateCommon>, index: number, pagePolicy: PageKeyPolicy): AnalyticsEvent {
  const page = pageFields(value, index, pagePolicy)
  return {
    ...common, kind: 'event', client_instance_id: uuid(value.client_instance_id, index, 'client_instance_id'),
    client_sequence: safeInteger(value.client_sequence, index, 'client_sequence'), name: boundedString(value.name, 'name', 1, 120, index),
    ...(optionalIdentifier(value.business_user_id, index, 'business_user_id')), ...page,
    ...(optionalObject(value.browser, ['name', 'version']) && { browser: optionalDevice(value.browser, index, 'browser') }),
    ...(optionalObject(value.device, ['type', 'os']) && { device: optionalDevice(value.device, index, 'device') }),
    ...(optionalString(value.release, 200, index, 'release') && { release: optionalString(value.release, 200, index, 'release') }),
    ...(value.properties !== undefined && { properties: safeJsonObject(value.properties, index, 'properties') }),
  }
}

function validateLogin(value: Record<string, unknown>, common: ReturnType<typeof validateCommon>, index: number): LoginEvent {
  return {
    ...common, kind: 'login', client_instance_id: uuid(value.client_instance_id, index, 'client_instance_id'),
    client_sequence: safeInteger(value.client_sequence, index, 'client_sequence'), business_user_id: identifier(value.business_user_id, index, 'business_user_id'),
    identity_assertion: boundedString(value.identity_assertion, 'identity_assertion', 1, 4096, index),
    ...(value.traits !== undefined && { traits: safeJsonObject(value.traits, index, 'traits') }),
  }
}

function validateError(value: Record<string, unknown>, common: ReturnType<typeof validateCommon>, index: number, policy: PageKeyPolicy): ErrorEvent {
  return { ...common, kind: 'error', ...(optionalIdentifier(value.business_user_id, index, 'business_user_id')), ...pageFields(value, index, policy),
    ...(optionalString(value.release, 200, index, 'release') && { release: optionalString(value.release, 200, index, 'release') }),
    ...(optionalString(value.dist, 200, index, 'dist') && { dist: optionalString(value.dist, 200, index, 'dist') }),
    ...(value.replay_session_id === undefined ? {} : { replay_session_id: uuid(value.replay_session_id, index, 'replay_session_id') }),
    error: safeError(value.error, index) }
}

function validateBehavior(value: Record<string, unknown>, common: ReturnType<typeof validateCommon>, index: number, policy: PageKeyPolicy): BehaviorEvent {
  const pageKey = pageKeyRequired(value.page_key, index, policy)
  const action = requiredEnum(value.action, ['autocapture_click', 'autocapture_submit', 'autocapture_change', 'scroll_depth', 'rage_click', 'dead_click'] as const, index, 'action')
  const dimensions = behaviorDimensions(value, index)
  const depth = value.depth_bucket === undefined ? undefined : depthBucket(value.depth_bucket, index)
  const clicks = value.click_count === undefined ? undefined : integerInRange(value.click_count, 3, 20, index, 'click_count')
  const elementToken = value.element_token === undefined ? undefined : boundedString(value.element_token, 'element_token', 1, 128, index, /^[A-Za-z0-9_-]+$/)
  const controlType = value.control_type === undefined ? undefined : requiredEnum(value.control_type, ['input', 'select', 'textarea'] as const, index, 'control_type')
  const deadClickHeuristic = value.dead_click_heuristic === undefined ? undefined : requiredEnum(value.dead_click_heuristic, ['no_navigation_or_interaction_v1'] as const, index, 'dead_click_heuristic')
  if (action === 'scroll_depth' && depth === undefined) throw invalid('depth_bucket', index)
  if (action !== 'scroll_depth' && depth !== undefined) throw invalid('depth_bucket', index)
  if (action === 'rage_click' && clicks === undefined) throw invalid('click_count', index)
  if (action !== 'rage_click' && clicks !== undefined) throw invalid('click_count', index)
  if (action === 'scroll_depth' && (elementToken !== undefined || controlType !== undefined || deadClickHeuristic !== undefined)) throw invalid('behavior_details', index)
  if (!['autocapture_click', 'scroll_depth'].includes(action) && elementToken === undefined) throw invalid('element_token', index)
  if (action === 'autocapture_change' && controlType === undefined) throw invalid('control_type', index)
  if (action !== 'autocapture_change' && controlType !== undefined) throw invalid('control_type', index)
  if (action === 'dead_click' && deadClickHeuristic === undefined) throw invalid('dead_click_heuristic', index)
  if (action !== 'dead_click' && deadClickHeuristic !== undefined) throw invalid('dead_click_heuristic', index)
  return { ...common, kind: 'behavior', ...(optionalIdentifier(value.business_user_id, index, 'business_user_id')), page_key: pageKey,
    ...(optionalString(value.page_version, 200, index, 'page_version') && { page_version: optionalString(value.page_version, 200, index, 'page_version') }),
    ...(optionalString(value.release, 200, index, 'release') && { release: optionalString(value.release, 200, index, 'release') }), action, ...dimensions,
    ...(elementToken !== undefined && { element_token: elementToken }), ...(depth !== undefined && { depth_bucket: depth }), ...(clicks !== undefined && { click_count: clicks }),
    ...(controlType !== undefined && { control_type: controlType }), ...(deadClickHeuristic !== undefined && { dead_click_heuristic: deadClickHeuristic }) }
}

function validatePerformance(value: Record<string, unknown>, common: ReturnType<typeof validateCommon>, index: number, policy: PageKeyPolicy): PerformanceEvent {
  const pageKey = pageKeyRequired(value.page_key, index, policy)
  if (value.route !== undefined && pageKeyRequired(value.route, index, policy) !== pageKey) throw invalid('route', index)
  const metric = exactObject(value.metric, ['name', 'value', 'rating', 'metric_id'])
  const viewport = exactObject(value.viewport, ['width_bucket', 'height_bucket'])
  const metricName = requiredEnum(metric.name, ['CLS', 'INP', 'LCP', 'FCP', 'TTFB'] as const, index, 'metric.name')
  if (typeof metric.value !== 'number' || !Number.isFinite(metric.value) || metric.value < 0 || metric.value > 600_000) throw invalid('metric.value', index)
  return { ...common, kind: 'performance', ...(optionalIdentifier(value.business_user_id, index, 'business_user_id')), page_key: pageKey,
    ...(value.route !== undefined && { route: pageKey }), ...(optionalString(value.release, 200, index, 'release') && { release: optionalString(value.release, 200, index, 'release') }),
    navigation_type: requiredEnum(value.navigation_type, ['navigate', 'reload', 'back_forward', 'prerender', 'soft_navigation'] as const, index, 'navigation_type'),
    metric_name: metricName, value: metric.value, rating: requiredEnum(metric.rating, ['good', 'needs_improvement', 'poor'] as const, index, 'metric.rating'),
    metric_id: boundedString(metric.metric_id, 'metric.metric_id', 1, 128, index), viewport_width_bucket: integerInRange(viewport.width_bucket, 0, 10_000, index, 'viewport.width_bucket'),
    viewport_height_bucket: integerInRange(viewport.height_bucket, 0, 10_000, index, 'viewport.height_bucket'), browser: requiredEnum(value.browser, ['edge', 'firefox', 'chrome', 'safari', 'other'] as const, index, 'browser'),
    device: requiredEnum(value.device, ['desktop', 'tablet', 'mobile'] as const, index, 'device') }
}

function validateReplay(body: unknown, options: IngestValidationOptions): ReplayRequest {
  const envelope = exactObject(body, ['key', 'session', 'chunks'])
  const session = exactObject(envelope.session, ['replay_session_id', 'visitor_id', 'business_user_id', 'started_at', 'release', 'policy_version', 'initial_route', 'sample_decision'])
  if (!Array.isArray(envelope.chunks) || envelope.chunks.length < 1 || envelope.chunks.length > 4) throw invalid('chunks')
  const initialRoute = pageKeyRequired(session.initial_route, undefined, options.pagePolicy)
  const chunks = envelope.chunks.map((chunk, index) => {
    const item = exactObject(chunk, ['chunk_id', 'sequence_start', 'sequence_end', 'encoding', 'data', 'sha256', 'occurred_from', 'occurred_to'])
    const start = safeInteger(item.sequence_start, index, 'sequence_start')
    const end = safeInteger(item.sequence_end, index, 'sequence_end')
    if (end < start) throw invalid('sequence_end', index)
    const parsed = { chunk_id: uuid(item.chunk_id, index, 'chunk_id'), sequence_start: start, sequence_end: end, encoding: requiredEnum(item.encoding, ['rrweb-json', 'rrweb-json+gzip'] as const, index, 'encoding'), data: boundedString(item.data, 'data', 1, 350000, index), sha256: boundedString(item.sha256, 'sha256', 64, 64, index, SHA256), occurred_from: timestamp(item.occurred_from, index, options), occurred_to: timestamp(item.occurred_to, index, options) }
    if (Date.parse(parsed.occurred_to) < Date.parse(parsed.occurred_from)) throw invalid('occurred_to', index)
    try { validateSanitizedReplayChunk(parsed) } catch (error) { if (error instanceof ReplayPayloadError) throw new IngestContractError('invalid_replay_payload', index, 'data'); throw error }
    return parsed
  })
  return { key: boundedString(envelope.key, 'key', 1, 512), session: { replay_session_id: uuid(session.replay_session_id, undefined, 'replay_session_id'), visitor_id: identifier(session.visitor_id, undefined, 'visitor_id'), ...(optionalIdentifier(session.business_user_id, undefined, 'business_user_id')), started_at: timestamp(session.started_at, undefined, options), ...(optionalString(session.release, 200, undefined, 'release') && { release: optionalString(session.release, 200, undefined, 'release') }), policy_version: safeInteger(session.policy_version, undefined, 'policy_version'), initial_route: initialRoute, sample_decision: boolean(session.sample_decision, 'sample_decision') }, chunks }
}

function allowedFields(lane: Exclude<IngestLane, 'replay'>, value: unknown): string[] {
  const kind = isRecord(value) ? value.kind : undefined
  if (lane === 'analytics' && kind === 'event') return ['client_event_id', 'client_instance_id', 'client_sequence', 'kind', 'name', 'visitor_id', 'business_user_id', 'occurred_at', 'url', 'route', 'browser', 'device', 'release', 'properties']
  if (lane === 'analytics' && kind === 'login') return ['client_event_id', 'client_instance_id', 'client_sequence', 'kind', 'visitor_id', 'business_user_id', 'identity_assertion', 'occurred_at', 'traits']
  if (lane === 'error') return ['client_event_id', 'kind', 'visitor_id', 'business_user_id', 'occurred_at', 'release', 'dist', 'replay_session_id', 'error', 'url', 'route']
  if (lane === 'behavior') return ['client_event_id', 'kind', 'visitor_id', 'business_user_id', 'occurred_at', 'page_key', 'page_version', 'release', 'action', 'viewport_width', 'viewport_height', 'document_width', 'document_height', 'client_x', 'client_y', 'document_x', 'document_y', 'element_token', 'depth_bucket', 'click_count', 'control_type', 'dead_click_heuristic']
  return ['client_event_id', 'kind', 'visitor_id', 'business_user_id', 'occurred_at', 'page_key', 'route', 'release', 'navigation_type', 'metric', 'viewport', 'browser', 'device']
}

function behaviorDimensions(value: Record<string, unknown>, index: number): Pick<BehaviorEvent, 'viewport_width' | 'viewport_height' | 'document_width' | 'document_height' | 'client_x' | 'client_y' | 'document_x' | 'document_y'> {
  const keys = ['viewport_width', 'viewport_height', 'document_width', 'document_height', 'client_x', 'client_y', 'document_x', 'document_y'] as const
  const present = keys.filter(key => value[key] !== undefined)
  if (!present.length) return {}
  if (present.length !== keys.length) throw invalid('coordinates', index)
  const result = {
    viewport_width: integerInRange(value.viewport_width, 1, 1_000_000, index, 'viewport_width'),
    viewport_height: integerInRange(value.viewport_height, 1, 1_000_000, index, 'viewport_height'),
    document_width: integerInRange(value.document_width, 1, 1_000_000, index, 'document_width'),
    document_height: integerInRange(value.document_height, 1, 1_000_000, index, 'document_height'),
    client_x: integerInRange(value.client_x, 0, 1_000_000, index, 'client_x'),
    client_y: integerInRange(value.client_y, 0, 1_000_000, index, 'client_y'),
    document_x: integerInRange(value.document_x, 0, 1_000_000, index, 'document_x'),
    document_y: integerInRange(value.document_y, 0, 1_000_000, index, 'document_y'),
  }
  if (result.document_width < result.viewport_width || result.document_height < result.viewport_height || result.document_x > result.document_width || result.document_y > result.document_height) throw invalid('coordinates', index)
  return result
}

function pageFields(value: Record<string, unknown>, index: number, policy: PageKeyPolicy) {
  const url = value.url === undefined ? undefined : pageKeyRequired(value.url, index, policy)
  const route = value.route === undefined ? undefined : pageKeyRequired(value.route, index, policy)
  if (url !== undefined && route !== undefined && url !== route) throw invalid('url', index)
  return { ...(url !== undefined && { url }), ...(route !== undefined && { route }) }
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid('body')
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw invalid(key)
  return value
}
function safeJsonObject(value: unknown, index: number, field: string): Record<string, never> {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid(field, index)
  assertSafeJson(value, 1, index, field)
  return value as Record<string, never>
}
/**
 * Errors have a deliberately separate, closed shape. Error stacks are useful
 * diagnostic data and have a documented 12 KiB bound, unlike generic event
 * properties whose strings are capped at 512 characters.
 */
function safeError(value: unknown, index: number): Record<string, JsonValue> {
  const error = exactObject(value, ['mechanism', 'type', 'message', 'stack', 'frames'])
  const mechanism = requiredEnum(error.mechanism, ['manual', 'onerror', 'unhandledrejection'] as const, index, 'error.mechanism')
  const type = boundedString(error.type, 'error.type', 1, 128, index)
  const message = redactErrorText(boundedString(error.message, 'error.message', 1, 2048, index))
  const stack = error.stack === undefined ? undefined : redactErrorText(boundedString(error.stack, 'error.stack', 1, 12 * 1024, index))
  let frames: JsonValue[] | undefined
  if (error.frames !== undefined) {
    if (!Array.isArray(error.frames) || error.frames.length > 40) throw invalid('error.frames', index)
    frames = error.frames.map(frame => {
      const normalized = normalizeErrorFrame(frame)
      if (!normalized) throw invalid('error.frames', index)
      return normalized as unknown as JsonValue
    })
  }
  return { mechanism, type, message, ...(stack === undefined ? {} : { stack }), ...(frames ? { frames } : {}) }
}

function redactErrorText(value: string): string {
  return value
    .replace(/([?&][A-Za-z0-9_.-]+)=([^\s&#)]+)/g, '$1=[redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/\b(?:bearer\s+)?(?:api[_-]?key|token|password|secret|authorization|cookie|session)\s*[:=]\s*[^\s,;\[]+/gi, '[redacted-secret]')
}
function assertSafeJson(value: unknown, depth: number, index: number, field: string): void {
  if (depth > 4) throw invalid(field, index)
  if (typeof value === 'string') { if (value.length > 512 || DISALLOWED_TEXT.test(value)) throw invalid(field, index); return }
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw invalid(field, index); return }
  if (Array.isArray(value)) { if (value.length > 20) throw invalid(field, index); value.forEach(item => assertSafeJson(item, depth + 1, index, field)); return }
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid(field, index)
  const keys = Object.keys(value)
  if (keys.length > 40 || keys.some(key => key.length > 128 || RESERVED_OR_SENSITIVE_KEY.test(key))) throw invalid(field, index)
  for (const item of Object.values(value)) assertSafeJson(item, depth + 1, index, field)
}
function optionalDevice(value: unknown, index: number, field: string): { [key: string]: string } {
  const record = value as Record<string, unknown>
  const result: { [key: string]: string } = {}
  for (const [key, item] of Object.entries(record)) result[key] = boundedString(item, `${field}.${key}`, 1, 128, index)
  return result
}
function optionalObject(value: unknown, keys: string[]): boolean { if (value === undefined) return false; exactObject(value, keys); return true }
function optionalString(value: unknown, max: number, index?: number, field = 'value'): string | undefined { return value === undefined ? undefined : boundedString(value, field, 1, max, index) }
function optionalIdentifier(value: unknown, index?: number, field = 'value'): { [key: string]: string } { return value === undefined ? {} : { [field]: identifier(value, index, field) } }
function identifier(value: unknown, index?: number, field = 'value'): string { return boundedString(value, field, 1, 128, index) }
function uuid(value: unknown, index?: number, field = 'value'): string { return boundedString(value, field, 36, 36, index, UUID) }
function boundedString(value: unknown, field: string, min: number, max: number, index?: number, pattern?: RegExp): string { if (typeof value !== 'string' || value.length < min || value.length > max || value.trim() !== value || (pattern && !pattern.test(value))) throw invalid(field, index); return value }
function safeInteger(value: unknown, index?: number, field = 'value'): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid(field, index); return value }
function integerInRange(value: unknown, minimum: number, maximum: number, index?: number, field = 'value'): number { const parsed = safeInteger(value, index, field); if (parsed < minimum || parsed > maximum) throw invalid(field, index); return parsed }
function depthBucket(value: unknown, index: number): 25 | 50 | 75 | 100 { const parsed = integerInRange(value, 25, 100, index, 'depth_bucket'); if (parsed !== 25 && parsed !== 50 && parsed !== 75 && parsed !== 100) throw invalid('depth_bucket', index); return parsed }
function boolean(value: unknown, field: string): boolean { if (typeof value !== 'boolean') throw invalid(field); return value }
function timestamp(value: unknown, index: number | undefined, options: IngestValidationOptions): string { const raw = boundedString(value, 'occurred_at', 1, 64, index); const ms = Date.parse(raw); const now = options.now?.getTime() ?? Date.now(); if (!Number.isFinite(ms) || ms < now - (options.maxPastAgeMs ?? 7 * 86400000) || ms > now + (options.maxFutureSkewMs ?? 300000)) throw invalid('occurred_at', index); return new Date(ms).toISOString() }
function pageKeyRequired(value: unknown, index: number | undefined, policy: PageKeyPolicy): string { const key = sanitizePageKey(value, policy); if (!key) throw invalid('page_key', index); return key }
function requiredEnum<T extends string>(value: unknown, allowed: readonly T[], index?: number, field = 'value'): T { if (typeof value !== 'string' || !allowed.includes(value as T)) throw invalid(field, index); return value as T }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isSafeTemplate(template: string): boolean { return template.startsWith('/') && !/[?#@]/.test(template) && template.split('/').every(segment => segment === '' || /^:[A-Za-z][A-Za-z0-9_]*$/.test(segment) || /^[A-Za-z0-9._~-]+$/.test(segment)) }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function invalid(field: string, eventIndex?: number): IngestContractError { return new IngestContractError('invalid_ingest_event', eventIndex, field) }
