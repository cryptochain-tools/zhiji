import { IngestLane } from '../database/types'
import { httpError } from '../../lib/http'

export interface UsageScope { tenantId: string; projectId: string }
export interface UsageQuery { from: Date; to: Date; lane?: IngestLane }
/** PostgreSQL `date` is deliberately returned as ISO text, avoiding driver timezone coercion. */
export interface UsageDaily { usage_date: string; lane: IngestLane; received_events: number; received_bytes: number }

const lanes: readonly IngestLane[] = [ 'analytics', 'error', 'behavior', 'replay', 'performance' ]

export function parseUsageQuery(raw: unknown, now = new Date()): UsageQuery {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  // Ledger rows are UTC calendar days; accepting partial timestamps would make
  // a whole-day aggregate look like an exact partial-day result.
  const to = value.to === undefined ? nextUtcDay(now) : date(value.to)
  const from = value.from === undefined ? new Date(to.getTime() - 30 * 86_400_000) : date(value.from)
  if (!isUtcDay(from) || !isUtcDay(to) || from >= to || to.getTime() > nextUtcDay(now).getTime() || to.getTime() - from.getTime() > 92 * 86_400_000) throw invalid()
  const lane = value.lane === undefined ? undefined : value.lane
  if (lane !== undefined && (!lanes.includes(lane as IngestLane) || typeof lane !== 'string')) throw invalid()
  return { from, to, lane: lane as IngestLane | undefined }
}

function invalid(): never { throw httpError(400, 'invalid_usage_query', 'Usage query is invalid') }
function date(value: unknown): Date { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return invalid(); return new Date(value) }
function isUtcDay(value: Date): boolean { return value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0 }
function nextUtcDay(value: Date): Date { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + 1)) }
