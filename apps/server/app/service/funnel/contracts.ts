import { httpError } from '../../lib/http'

export interface FunnelScope { tenantId: string; projectId: string }
export type FunnelSubjectKind = 'visitor' | 'business_user'

/** A funnel always has an explicit identity unit. The range is its conversion window. */
export interface FunnelQuery extends FunnelScope {
  from: Date
  to: Date
  steps: readonly string[]
  subjectKind: FunnelSubjectKind
}

export interface FunnelStepCount { name: string; count: number }

export function parseFunnelQuery(scope: FunnelScope, raw: unknown, now = new Date()): FunnelQuery {
  if (!isObject(raw) || !isDate(raw.from) || !isDate(raw.to) || !Array.isArray(raw.steps)) throw invalid()
  const from = new Date(raw.from)
  const to = new Date(raw.to)
  if (from >= to || to.getTime() > now.getTime() + 5 * 60_000 || to.getTime() - from.getTime() > 90 * 24 * 60 * 60_000) throw invalid()
  if (raw.steps.length < 2 || raw.steps.length > 5 || !raw.steps.every(isEventName)) throw invalid()
  if (raw.subject_kind !== 'visitor' && raw.subject_kind !== 'business_user') throw invalid()
  return { ...scope, from, to, steps: [ ...raw.steps ], subjectKind: raw.subject_kind }
}

function invalid(): never { throw httpError(400, 'invalid_funnel_query', 'Funnel query is invalid') }
function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function isDate(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) }
function isEventName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value
}
