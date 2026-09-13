import { createHash } from 'node:crypto'
import { ErrorEvent, IngestCounts, PerformanceEvent } from '../../contracts/ingest'
import { validateIngest } from '../ingest'
import { IngestRateLimiter } from '../ingest/rateLimit'
import { IngestWriter, ServerIngestProject } from '../ingest/transport'
import { QuotaExceededError } from '../usage/quota'

const MAX_ITEMS = 50
const MAX_DURATION_MS = 86_400_000
const RESOURCE_ATTRIBUTES = new Set([
  'service.name', 'service.version', 'service.namespace', 'service.instance.id', 'deployment.environment', 'zhiji.visitor_id',
])
const EXCEPTION_ATTRIBUTES = new Set(['exception.type', 'exception.message', 'exception.stacktrace'])

export type OtlpSignal = 'traces' | 'metrics' | 'logs'

export interface OtlpDependencies {
  resolveProject(key: string): Promise<ServerIngestProject | null>
  writer?: IngestWriter
  rateLimiter?: IngestRateLimiter
  now?: Date
}

export class OtlpTransportError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

interface OtlpScope { tenantId: string; projectId: string; projectKeyId: string }
interface OtlpRecords { errors: ErrorEvent[]; performance: PerformanceEvent[] }

/**
 * A deliberately small OTLP/HTTP JSON adapter. It is not an OTLP collector:
 * it accepts a closed subset needed to project exception events and duration
 * observations into Zhiji's existing facts. Payload bodies, baggage, links,
 * generic span/log attributes and unknown resource attributes are rejected.
 */
export async function processOtlp(signal: OtlpSignal, keyHeader: string, body: unknown, dependencies: OtlpDependencies): Promise<IngestCounts> {
  const key = keyHeader.trim()
  if (!key) throw new OtlpTransportError(401, 'missing_otel_key', 'X-Zhiji-Key is required')
  const project = await dependencies.resolveProject(key)
  if (!isProject(project)) throw new OtlpTransportError(401, 'invalid_otel_key', 'OTLP key is invalid')
  if (!dependencies.writer) throw new OtlpTransportError(503, 'ingest_unavailable', 'Ingestion persistence is unavailable')
  const records = parse(signal, body, dependencies.now ?? new Date())
  const scope: OtlpScope = { tenantId: project.tenantId, projectId: project.projectId, projectKeyId: project.projectKeyId }
  const total = emptyCounts()
  if (records.errors.length) {
    await consume(dependencies.rateLimiter, scope, 'error')
    const payload = validateIngest('error', { key, events: records.errors }, { now: dependencies.now, pagePolicy: project.pagePolicy })
    try { add(total, await dependencies.writer.write({ scope, lane: 'error', payload, clientEventIds: records.errors.map(item => item.client_event_id) })) }
    catch (error) { if (error instanceof QuotaExceededError) throw new OtlpTransportError(429, 'quota_exceeded', `Commercial usage quota exceeded; resets at ${error.resetsAt.toISOString()}`); throw error }
  }
  if (records.performance.length) {
    await consume(dependencies.rateLimiter, scope, 'performance')
    const payload = { lane: 'performance' as const, key, events: records.performance }
    try { add(total, await dependencies.writer.write({ scope, lane: 'performance', payload, clientEventIds: records.performance.map(item => item.client_event_id) })) }
    catch (error) { if (error instanceof QuotaExceededError) throw new OtlpTransportError(429, 'quota_exceeded', `Commercial usage quota exceeded; resets at ${error.resetsAt.toISOString()}`); throw error }
  }
  return total
}

function parse(signal: OtlpSignal, input: unknown, now: Date): OtlpRecords {
  switch (signal) {
    case 'traces': return parseTraces(input, now)
    case 'metrics': return parseMetrics(input, now)
    case 'logs': return parseLogs(input, now)
  }
}

function parseTraces(input: unknown, now: Date): OtlpRecords {
  const root = object(input, ['resourceSpans'])
  const errors: ErrorEvent[] = []
  const performance: PerformanceEvent[] = []
  for (const resourceSpan of array(root.resourceSpans, 'resourceSpans', MAX_ITEMS)) {
    const entry = object(resourceSpan, ['resource', 'scopeSpans', 'schemaUrl'])
    const resource = resourceInfo(entry.resource)
    for (const scopeSpan of array(entry.scopeSpans, 'scopeSpans', MAX_ITEMS)) {
      const scope = object(scopeSpan, ['scope', 'spans', 'schemaUrl'])
      if (scope.scope !== undefined) scopeInfo(scope.scope)
      for (const rawSpan of array(scope.spans, 'spans', MAX_ITEMS)) {
        const span = object(rawSpan, ['traceId', 'spanId', 'parentSpanId', 'name', 'kind', 'startTimeUnixNano', 'endTimeUnixNano', 'status', 'events', 'attributes', 'links', 'droppedAttributesCount', 'droppedEventsCount', 'droppedLinksCount', 'flags', 'traceState'])
        rejectNonEmpty(span.attributes, 'span.attributes')
        rejectNonEmpty(span.links, 'span.links')
        rejectPresent(span.traceState, 'traceState')
        const traceId = hex(span.traceId, 32, 'traceId')
        const spanId = hex(span.spanId, 16, 'spanId')
        const name = text(span.name, 'name', 200)
        const started = unixNanos(span.startTimeUnixNano, 'startTimeUnixNano', now)
        const ended = unixNanos(span.endTimeUnixNano, 'endTimeUnixNano', now)
        const duration = ended.getTime() - started.getTime()
        if (duration < 0 || duration > MAX_DURATION_MS) throw invalid('span duration')
        performance.push(performanceRecord(`trace:${traceId}:${spanId}`, resource, name, ended, duration))
        for (const rawEvent of optionalArray(span.events, 'events', MAX_ITEMS)) {
          const event = object(rawEvent, ['timeUnixNano', 'name', 'attributes', 'droppedAttributesCount'])
          if (text(event.name, 'event.name', 100) !== 'exception') throw invalid('span events only support exception')
          errors.push(exceptionRecord(`trace:${traceId}:${spanId}:${unixNanos(event.timeUnixNano, 'event.timeUnixNano', now).getTime()}`, resource, event.attributes, unixNanos(event.timeUnixNano, 'event.timeUnixNano', now)))
        }
      }
    }
  }
  return bounded({ errors, performance })
}

function parseMetrics(input: unknown, now: Date): OtlpRecords {
  const root = object(input, ['resourceMetrics'])
  const performance: PerformanceEvent[] = []
  for (const resourceMetric of array(root.resourceMetrics, 'resourceMetrics', MAX_ITEMS)) {
    const entry = object(resourceMetric, ['resource', 'scopeMetrics', 'schemaUrl'])
    const resource = resourceInfo(entry.resource)
    for (const scopeMetric of array(entry.scopeMetrics, 'scopeMetrics', MAX_ITEMS)) {
      const scope = object(scopeMetric, ['scope', 'metrics', 'schemaUrl'])
      if (scope.scope !== undefined) scopeInfo(scope.scope)
      for (const rawMetric of array(scope.metrics, 'metrics', MAX_ITEMS)) {
        const metric = object(rawMetric, ['name', 'description', 'unit', 'gauge'])
        if (text(metric.name, 'metric.name', 120) !== 'zhiji.span.duration') throw invalid('unsupported metric name')
        const gauge = object(metric.gauge, ['dataPoints'])
        for (const pointRaw of array(gauge.dataPoints, 'gauge.dataPoints', MAX_ITEMS)) {
          const point = object(pointRaw, ['attributes', 'startTimeUnixNano', 'timeUnixNano', 'asDouble', 'asInt', 'exemplars', 'flags'])
          rejectNonEmpty(point.attributes, 'metric point attributes')
          rejectNonEmpty(point.exemplars, 'metric exemplars')
          const value = numeric(point.asDouble ?? point.asInt, 'metric value')
          if (value < 0 || value > MAX_DURATION_MS) throw invalid('metric value')
          const at = unixNanos(point.timeUnixNano, 'timeUnixNano', now)
          performance.push(performanceRecord(`metric:${resource.serviceName}:${at.getTime()}:${value}`, resource, 'zhiji.span.duration', at, value))
        }
      }
    }
  }
  return bounded({ errors: [], performance })
}

function parseLogs(input: unknown, now: Date): OtlpRecords {
  const root = object(input, ['resourceLogs'])
  const errors: ErrorEvent[] = []
  for (const resourceLog of array(root.resourceLogs, 'resourceLogs', MAX_ITEMS)) {
    const entry = object(resourceLog, ['resource', 'scopeLogs', 'schemaUrl'])
    const resource = resourceInfo(entry.resource)
    for (const scopeLog of array(entry.scopeLogs, 'scopeLogs', MAX_ITEMS)) {
      const scope = object(scopeLog, ['scope', 'logRecords', 'schemaUrl'])
      if (scope.scope !== undefined) scopeInfo(scope.scope)
      for (const rawLog of array(scope.logRecords, 'logRecords', MAX_ITEMS)) {
        const log = object(rawLog, ['timeUnixNano', 'observedTimeUnixNano', 'severityNumber', 'severityText', 'body', 'attributes', 'droppedAttributesCount', 'flags', 'traceId', 'spanId'])
        // OTLP log body is commonly arbitrary application text. It is never
        // accepted by this adapter, including empty structured body objects.
        rejectPresent(log.body, 'log body')
        if (text(log.severityText, 'severityText', 32) !== 'ERROR') throw invalid('only ERROR exception logs are supported')
        const at = unixNanos(log.timeUnixNano, 'timeUnixNano', now)
        errors.push(exceptionRecord(`log:${hex(log.traceId, 32, 'traceId')}:${hex(log.spanId, 16, 'spanId')}:${at.getTime()}`, resource, log.attributes, at))
      }
    }
  }
  return bounded({ errors, performance: [] })
}

interface ResourceInfo { serviceName: string; release?: string; visitorId: string }
function resourceInfo(value: unknown): ResourceInfo {
  const resource = object(value, ['attributes', 'droppedAttributesCount'])
  const attributes = attributeMap(resource.attributes, RESOURCE_ATTRIBUTES, 'resource attributes')
  const serviceName = requiredAttribute(attributes, 'service.name', 120)
  const visitor = identifier(optionalAttribute(attributes, 'zhiji.visitor_id', 128) ?? `otel:${serviceName}`, 'zhiji.visitor_id')
  const rawRelease = optionalAttribute(attributes, 'service.version', 200)
  const release = rawRelease === undefined ? undefined : text(rawRelease, 'service.version', 200)
  return { serviceName, visitorId: visitor, ...(release ? { release } : {}) }
}
function scopeInfo(value: unknown): void {
  const scope = object(value, ['name', 'version', 'attributes', 'droppedAttributesCount'])
  text(scope.name, 'scope.name', 120)
  if (scope.version !== undefined) text(scope.version, 'scope.version', 120)
  rejectNonEmpty(scope.attributes, 'scope attributes')
}
function exceptionRecord(seed: string, resource: ResourceInfo, rawAttributes: unknown, occurredAt: Date): ErrorEvent {
  const attributes = attributeMap(rawAttributes, EXCEPTION_ATTRIBUTES, 'exception attributes')
  return {
    client_event_id: uuid(seed), kind: 'error', visitor_id: resource.visitorId, occurred_at: occurredAt.toISOString(),
    ...(resource.release ? { release: resource.release } : {}),
    error: { mechanism: 'manual', type: requiredAttribute(attributes, 'exception.type', 128), message: requiredAttribute(attributes, 'exception.message', 2048), ...(optionalAttribute(attributes, 'exception.stacktrace', 12 * 1024) ? { stack: optionalAttribute(attributes, 'exception.stacktrace', 12 * 1024)! } : {}) },
  }
}
function performanceRecord(seed: string, resource: ResourceInfo, name: string, occurredAt: Date, value: number): PerformanceEvent {
  return {
    client_event_id: uuid(seed), kind: 'performance', visitor_id: resource.visitorId, occurred_at: occurredAt.toISOString(),
    ...(resource.release ? { release: resource.release } : {}), page_key: '/otel', route: '/otel', navigation_type: 'soft_navigation', metric_name: 'SPAN_DURATION', value,
    rating: value <= 500 ? 'good' : value <= 2_000 ? 'needs_improvement' : 'poor', metric_id: `${resource.serviceName}:${name}`.slice(0, 128), viewport_width_bucket: 0, viewport_height_bucket: 0, browser: 'other', device: 'other',
  }
}

function attributeMap(value: unknown, allowed: ReadonlySet<string>, label: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const item of optionalArray(value, label, MAX_ITEMS)) {
    const attr = object(item, ['key', 'value'])
    const key = text(attr.key, `${label}.key`, 120)
    if (!allowed.has(key) || map.has(key)) throw invalid(`unsupported ${label}`)
    const valueObject = object(attr.value, ['stringValue'])
    map.set(key, text(valueObject.stringValue, `${label}.${key}`, key === 'exception.stacktrace' ? 12 * 1024 : 2048))
  }
  return map
}
function requiredAttribute(attributes: Map<string, string>, key: string, max: number): string { const value = attributes.get(key); if (!value || value.length > max) throw invalid(`missing ${key}`); return value }
function optionalAttribute(attributes: Map<string, string>, key: string, max: number): string | undefined { const value = attributes.get(key); if (value !== undefined && value.length > max) throw invalid(`${key} is too long`); return value }
function unixNanos(value: unknown, label: string, now: Date): Date { if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw invalid(label); const millis = Number(BigInt(value) / 1_000_000n); if (!Number.isSafeInteger(millis)) throw invalid(label); const date = new Date(millis); if (Number.isNaN(date.getTime()) || date.getTime() < now.getTime() - 7 * 86_400_000 || date.getTime() > now.getTime() + 5 * 60_000) throw invalid(label); return date }
function hex(value: unknown, length: number, label: string): string { if (typeof value !== 'string' || !new RegExp(`^[0-9a-fA-F]{${length}}$`).test(value)) throw invalid(label); return value.toLowerCase() }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid('object'); for (const key of Object.keys(value)) if (!keys.includes(key)) throw invalid(`unsupported field ${key}`); return value as Record<string, unknown> }
function array(value: unknown, label: string, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) throw invalid(label); return value }
function optionalArray(value: unknown, label: string, max: number): unknown[] { return value === undefined ? [] : array(value, label, max) }
function text(value: unknown, label: string, max: number): string { if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(label); return value }
function numeric(value: unknown, label: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(label); return value }
function identifier(value: string, label: string): string { if (value.length > 128 || value.trim() !== value) throw invalid(label); return value }
function rejectPresent(value: unknown, label: string): void { if (value !== undefined) throw invalid(label) }
function rejectNonEmpty(value: unknown, label: string): void { if (value !== undefined && (!Array.isArray(value) || value.length > 0)) throw invalid(label) }
function invalid(message: string): OtlpTransportError { return new OtlpTransportError(400, 'invalid_otlp_payload', `Unsupported OTLP payload: ${message}`) }
function uuid(seed: string): string { const bytes = createHash('sha256').update(seed).digest().subarray(0, 16); bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80; const hex = bytes.toString('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` }
function bounded(value: OtlpRecords): OtlpRecords { if (value.errors.length + value.performance.length > MAX_ITEMS) throw invalid('too many records'); return value }
function isProject(value: ServerIngestProject | null): value is ServerIngestProject { return Boolean(value && value.tenantId && value.projectId && value.projectKeyId && value.pagePolicy) }
function emptyCounts(): IngestCounts { return { accepted: 0, duplicate: 0, sampled: 0, rate_limited: 0, dropped: 0 } }
function add(target: IngestCounts, value: IngestCounts): void { for (const key of Object.keys(target) as Array<keyof IngestCounts>) target[key] += value[key] }
async function consume(limiter: IngestRateLimiter | undefined, scope: OtlpScope, lane: 'error' | 'performance'): Promise<void> { if (!limiter) throw new OtlpTransportError(503, 'rate_limit_unavailable', 'Ingest rate limiting is unavailable'); try { if (!await limiter.consume({ ...scope, lane })) throw new OtlpTransportError(429, 'rate_limited', 'Ingest rate limit exceeded') } catch (error) { if (error instanceof OtlpTransportError) throw error; throw new OtlpTransportError(503, 'rate_limit_unavailable', 'Ingest rate limiting is unavailable') } }
