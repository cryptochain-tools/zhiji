import { JsonValue } from '../../contracts/ingest'

export const ERROR_STATUSES = [ 'unresolved', 'resolved', 'ignored' ] as const
export type ErrorStatus = typeof ERROR_STATUSES[number]

export interface ErrorScope { tenantId: string; projectId: string }

export interface ErrorGroupSnapshot {
  group_id: string
  status: ErrorStatus
  resolved_at: Date | null
  state_version: number
}

export interface ErrorStatePatch {
  status: ErrorStatus
  expected_state_version: number
  reason?: string
}

export interface NewErrorGroup extends ErrorScope {
  id: string
  fingerprintAlgorithmVersion: string
  fingerprint: Buffer
  type: string
  displayMessage: string
  canonicalStack?: string
  release?: string
  occurredAt: Date
}

export interface NewErrorOccurrence extends ErrorScope {
  id: string
  groupId: string
  clientEventId: string
  occurredAt: Date
  visitorId: string
  businessUserId?: string
  release?: string
  dist?: string
  replaySessionId?: string
  url?: string
  route?: string
  browser?: Record<string, JsonValue>
  device?: Record<string, JsonValue>
  mechanism?: string
  stack?: string
  frames?: JsonValue[]
}

export interface ErrorGroupRecord {
  id: string
  tenant_id: string
  project_id: string
  fingerprint_algorithm_version: string
  fingerprint: Buffer
  type: string
  display_message: string
  canonical_stack: string | null
  release: string | null
  first_seen: Date
  last_seen: Date
  occurrence_count: number
  status: ErrorStatus
  resolved_at: Date | null
  state_version: number
}

export interface ErrorOccurrenceRecord {
  id: string
  tenant_id: string
  project_id: string
  group_id: string
  client_event_id: string
  occurred_at: Date
  visitor_id: string
}

export interface ErrorStateHistoryRecord {
  id: string
  from_status: ErrorStatus
  to_status: ErrorStatus
  actor_user_id: string | null
  reason: string | null
  occurred_at: Date
}

export interface ErrorOccurrenceDetailRecord extends ErrorOccurrenceRecord {
  received_at: Date
  business_user_id: string | null
  release: string | null
  dist: string | null
  replay_session_id: string | null
  url: string | null
  route: string | null
  browser: Record<string, JsonValue>
  device: Record<string, JsonValue>
  mechanism: string | null
  stack: string | null
  frames: JsonValue[]
}

export interface ErrorGroupFilter extends ErrorScope {
  status?: ErrorStatus
  release?: string
  from: Date
  to: Date
  cursor?: ErrorCursor
  limit: number
}

export interface ErrorOccurrenceFilter extends ErrorScope {
  groupId: string
  from: Date
  to: Date
  cursor?: ErrorCursor
  limit: number
}

export interface ErrorCursor { occurredAt: Date; id: string }

export function parseErrorStatePatch(value: unknown): ErrorStatePatch | null {
  if (!isPlainObject(value)) return null
  const keys = Object.keys(value)
  if (!keys.every(key => key === 'status' || key === 'expected_state_version' || key === 'reason')) return null
  const status = value.status
  const expected = value.expected_state_version
  if (!isErrorStatus(status) || typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0) return null
  if (value.reason === undefined) return { status, expected_state_version: expected }
  if (typeof value.reason !== 'string') return null
  const reason = value.reason.trim()
  if (reason.length < 1 || reason.length > 512) return null
  return { status, expected_state_version: expected, reason }
}

export function isErrorStatus(value: unknown): value is ErrorStatus {
  return typeof value === 'string' && (ERROR_STATUSES as readonly string[]).includes(value)
}

export function automaticStatusAfterOccurrence(group: ErrorGroupSnapshot, occurredAt: Date): ErrorStatus {
  return group.status === 'resolved' && group.resolved_at && occurredAt > group.resolved_at ? 'unresolved' : group.status
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
