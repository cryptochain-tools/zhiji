import { httpError } from '../../lib/http'

export interface AdvancedAnalyticsScope { tenantId: string; projectId: string }
export type SubjectKind = 'visitor' | 'business_user'
export type RetentionPeriod = 'day' | 'week' | 'month'

export interface RetentionQuery extends AdvancedAnalyticsScope {
  from: Date
  to: Date
  startEvent: string
  returnEvent: string
  period: RetentionPeriod
  periodCount: number
  subjectKind: SubjectKind
  timezone: string
}

export interface PathQuery extends AdvancedAnalyticsScope {
  from: Date
  to: Date
  startEvent: string
  depth: number
  subjectKind: SubjectKind
}

export function parseRetentionQuery(scope: AdvancedAnalyticsScope, value: unknown, now = new Date()): RetentionQuery {
  if (!object(value) || !date(value.from) || !date(value.to) || !eventName(value.start_event) || !eventName(value.return_event)) throw invalid('invalid_retention_query')
  const periodCount = queryInteger(value.period_count, 1, 12)
  if (!period(value.period) || periodCount === null || !subject(value.subject_kind) || !timezone(value.timezone)) throw invalid('invalid_retention_query')
  const from = new Date(value.from)
  const to = new Date(value.to)
  if (!range(from, to, now)) throw invalid('invalid_retention_query')
  return { ...scope, from, to, startEvent: value.start_event, returnEvent: value.return_event, period: value.period, periodCount, subjectKind: value.subject_kind, timezone: value.timezone }
}

export function parsePathQuery(scope: AdvancedAnalyticsScope, value: unknown, now = new Date()): PathQuery {
  if (!object(value) || !date(value.from) || !date(value.to) || !eventName(value.start_event) || !subject(value.subject_kind)) throw invalid('invalid_path_query')
  const depth = queryInteger(value.depth, 2, 5)
  if (depth === null) throw invalid('invalid_path_query')
  const from = new Date(value.from)
  const to = new Date(value.to)
  if (!range(from, to, now)) throw invalid('invalid_path_query')
  return { ...scope, from, to, startEvent: value.start_event, depth, subjectKind: value.subject_kind }
}

function range(from: Date, to: Date, now: Date): boolean { return from < to && to.getTime() <= now.getTime() + 5 * 60_000 && to.getTime() - from.getTime() <= 90 * 24 * 60 * 60_000 }
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function date(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) }
function eventName(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value }
function queryInteger(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}
function period(value: unknown): value is RetentionPeriod { return value === 'day' || value === 'week' || value === 'month' }
function subject(value: unknown): value is SubjectKind { return value === 'visitor' || value === 'business_user' }
/** PostgreSQL validates named zones; keep the input bounded before it reaches the driver. */
function timezone(value: unknown): value is string { return typeof value === 'string' && value.length >= 1 && value.length <= 64 && /^[A-Za-z_+\-/]+$/.test(value) }
function invalid(code: 'invalid_retention_query' | 'invalid_path_query'): never { throw httpError(400, code, 'Advanced analytics query is invalid') }
