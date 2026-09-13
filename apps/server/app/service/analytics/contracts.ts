import { JsonValue } from '../../contracts/ingest'

export interface AnalyticsScope { tenantId: string; projectId: string }
export type AnalyticsGranularity = 'hour' | 'day'

export interface AnalyticsEventWrite extends AnalyticsScope {
  id: string
  clientEventId: string
  clientInstanceId: string
  clientSequence: number
  name: string
  visitorId: string
  businessUserId?: string
  url?: string
  route?: string
  browser?: Record<string, JsonValue>
  device?: Record<string, JsonValue>
  release?: string
  properties?: Record<string, JsonValue>
  occurredAt: Date
}

export interface TrendQuery extends AnalyticsScope {
  from: Date
  to: Date
  granularity: AnalyticsGranularity
  eventNames: readonly string[]
}

export interface TrendPoint {
  bucket_start: Date
  event_name: string
  event_count: number
  page_views: number
  visitors: number
}

export interface DashboardQuery extends AnalyticsScope { from: Date; to: Date; granularity: AnalyticsGranularity }
export interface EventFilter { key: string; value: string | number | boolean }
export interface EventsQuery extends AnalyticsScope { from: Date; to: Date; name?: string; filters: readonly EventFilter[]; groupBy?: 'name' | 'route' | 'release'; limit: number }

export function parseTrendQuery(scope: AnalyticsScope, value: unknown, now = new Date()): TrendQuery | null {
  if (!isObject(value) || !isDate(value.from) || !isDate(value.to) || (value.granularity !== 'hour' && value.granularity !== 'day') || !Array.isArray(value.event_names)) return null
  const from = new Date(value.from)
  const to = new Date(value.to)
  if (from >= to || to.getTime() > now.getTime() + 5 * 60_000 || to.getTime() - from.getTime() > 90 * 24 * 60 * 60_000) return null
  if (value.event_names.length > 6 || !value.event_names.every(isEventName)) return null
  return { ...scope, from, to, granularity: value.granularity, eventNames: [ ...new Set(value.event_names) ] }
}

export function parseDashboardQuery(scope: AnalyticsScope, value: unknown, now = new Date()): DashboardQuery | null {
  if (!isObject(value) || !isDate(value.from) || !isDate(value.to) || (value.granularity !== 'hour' && value.granularity !== 'day')) return null
  const from = new Date(value.from); const to = new Date(value.to)
  if (!boundedRange(from, to, now)) return null
  return { ...scope, from, to, granularity: value.granularity }
}

export function parseEventsQuery(scope: AnalyticsScope, value: unknown, now = new Date()): EventsQuery | null {
  if (!isObject(value) || !isDate(value.from) || !isDate(value.to)) return null
  const from = new Date(value.from); const to = new Date(value.to)
  if (!boundedRange(from, to, now)) return null
  const name = value.name === undefined ? undefined : isEventName(value.name) ? value.name : null
  if (name === null) return null
  const groupBy = value.group_by === undefined ? undefined : value.group_by === 'name' || value.group_by === 'route' || value.group_by === 'release' ? value.group_by : null
  if (groupBy === null || !Array.isArray(value.filters) || value.filters.length > 5) return null
  const filters: EventFilter[] = []
  for (const filter of value.filters) {
    if (!isObject(filter) || !isPropertyKey(filter.key) || filter.operator !== 'eq' || !scalar(filter.value)) return null
    filters.push({ key: filter.key, value: filter.value })
  }
  const limit = value.limit === undefined ? 50 : typeof value.limit === 'number' && Number.isSafeInteger(value.limit) && value.limit >= 1 && value.limit <= 100 ? value.limit : null
  if (limit === null) return null
  return { ...scope, from, to, ...(name && { name }), filters, ...(groupBy && { groupBy }), limit }
}

function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function isDate(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) }
function isEventName(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 200 }
function boundedRange(from: Date, to: Date, now: Date): boolean { return from < to && to.getTime() <= now.getTime() + 5 * 60_000 && to.getTime() - from.getTime() <= 90 * 24 * 60 * 60_000 }
function isPropertyKey(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/.test(value) }
function scalar(value: unknown): value is string | number | boolean { return typeof value === 'string' && value.length <= 200 || typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean' }
