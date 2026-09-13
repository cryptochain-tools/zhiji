import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { DatabaseClient } from '../database/types'
import { isUuid } from '../tenancy'
import {
  ErrorCursor,
  ErrorGroupFilter,
  ErrorGroupRecord,
  ErrorOccurrenceDetailRecord,
  ErrorScope,
  ErrorStateHistoryRecord,
  isErrorStatus,
  parseErrorStatePatch,
} from './contracts'
import { ErrorRepository } from './repository'
import { GeneratedErrorFrame, normalizeErrorFrame, SourceMapResolver } from '../sourcemaps/resolution'
import { sourceMapArtifactStoreFromConfig, PrivateSourceMapArtifactStore } from '../sourcemaps/artifacts'

const DAY = 24 * 60 * 60 * 1000
const MAX_RANGE = 90 * DAY
const DEFAULT_RANGE = 7 * DAY
const PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100

export interface ErrorGroupDto {
  id: string
  status: string
  type: string
  display_message: string
  release: string | null
  first_seen: string
  last_seen: string
  occurrence_count: number
  resolved_at: string | null
  state_version: number
}

export interface ErrorOccurrenceDto {
  id: string
  client_event_id: string
  occurred_at: string
  received_at: string
  visitor_id: string
  business_user_id: string | null
  release: string | null
  dist: string | null
  replay_session_id: string | null
  url: string | null
  route: string | null
  browser: unknown
  device: unknown
  mechanism: string | null
  stack: string | null
  frames: unknown
}

export class ErrorManagementService {
  constructor(private readonly database: DatabaseClient, private readonly sourceMapArtifacts?: PrivateSourceMapArtifactStore) {}

  async list(scope: ErrorScope, raw: unknown, now = new Date()): Promise<{ items: ErrorGroupDto[]; next_cursor: string | null }> {
    const filter = parseGroupFilter(scope, raw, now)
    const records = await new ErrorRepository(this.database).listGroups(filter)
    return page(records, filter.limit, record => groupDto(record), record => cursorFor(record.last_seen, record.id))
  }

  async detail(scope: ErrorScope, groupId: unknown, raw: unknown, now = new Date()): Promise<{
    group: ErrorGroupDto
    affected_visitor_count: number
    recent_occurrences: ErrorOccurrenceDto[]
    history: ReturnType<typeof historyDto>[]
  }> {
    ensureUuid(groupId, 'error_group_not_found', 'Error group was not found')
    const range = parseDateRange(raw, now)
    const repository = new ErrorRepository(this.database)
    const group = await repository.findGroup(scope, groupId)
    if (!group) throw httpError(404, 'error_group_not_found', 'Error group was not found')
    const [ affected, occurrences, history ] = await Promise.all([
      repository.countAffectedVisitors(scope, groupId, range.from, range.to),
      repository.listOccurrences({ ...scope, groupId, ...range, limit: 20 }),
      repository.listHistory(scope, groupId),
    ])
    const resolver = new SourceMapResolver(this.database, this.sourceMapArtifacts)
    const resolved = await Promise.all(occurrences.map(async occurrence => occurrenceDto(occurrence, await resolver.resolve(scope, occurrence.release, occurrence.dist, generatedFrames(occurrence.frames)))))
    return { group: groupDto(group), affected_visitor_count: affected, recent_occurrences: resolved, history: history.map(historyDto) }
  }

  async occurrences(scope: ErrorScope, groupId: unknown, raw: unknown, now = new Date()): Promise<{ items: ErrorOccurrenceDto[]; next_cursor: string | null }> {
    ensureUuid(groupId, 'error_group_not_found', 'Error group was not found')
    const range = parseDateRange(raw, now)
    const cursor = parseCursor(objectValue(raw).cursor)
    const limit = parseLimit(objectValue(raw).limit)
    const repository = new ErrorRepository(this.database)
    if (!await repository.findGroup(scope, groupId)) throw httpError(404, 'error_group_not_found', 'Error group was not found')
    const records = await repository.listOccurrences({ ...scope, groupId, ...range, cursor, limit })
    const resolver = new SourceMapResolver(this.database, this.sourceMapArtifacts)
    const items = await Promise.all(records.slice(0, limit).map(async record => occurrenceDto(record, await resolver.resolve(scope, record.release, record.dist, generatedFrames(record.frames)))))
    const last = records[limit - 1]
    return { items, next_cursor: records.length > limit && last ? cursorFor(last.occurred_at, last.id) : null }
  }

  async patchStatus(scope: ErrorScope, groupId: unknown, raw: unknown, actorUserId: unknown): Promise<ReturnType<typeof snapshotDto>> {
    ensureUuid(groupId, 'error_group_not_found', 'Error group was not found')
    if (!isUuid(actorUserId)) throw httpError(401, 'authentication_required', 'Authentication is required')
    const patch = parseErrorStatePatch(raw)
    if (!patch) throw httpError(400, 'invalid_error_state_patch', 'Error status patch is invalid')
    const repository = new ErrorRepository(this.database)
    const result = await repository.patchStatus(scope, groupId, patch, actorUserId)
    if (result) return snapshotDto(result)
    const current = await repository.currentSnapshot(scope, groupId)
    if (!current) throw httpError(404, 'error_group_not_found', 'Error group was not found')
    const error = httpError(409, 'error_state_version_conflict', 'Error state changed') as Error & { current?: unknown }
    error.current = snapshotDto(current)
    throw error
  }
}

export default class ErrorsService extends Service {
  private domain(): ErrorManagementService {
    const database = this.config.zhiji.database
    if (!database?.configured) throw httpError(503, 'errors_unavailable', 'Error management is unavailable')
    return new ErrorManagementService(database, sourceMapArtifactStoreFromConfig(this.config.zhiji.sourceMapArtifactStore))
  }
  list(scope: ErrorScope, query: unknown) { return this.domain().list(scope, query) }
  detail(scope: ErrorScope, groupId: unknown, query: unknown) { return this.domain().detail(scope, groupId, query) }
  occurrences(scope: ErrorScope, groupId: unknown, query: unknown) { return this.domain().occurrences(scope, groupId, query) }
  patchStatus(scope: ErrorScope, groupId: unknown, body: unknown, actorUserId: unknown) { return this.domain().patchStatus(scope, groupId, body, actorUserId) }
}

function parseGroupFilter(scope: ErrorScope, raw: unknown, now: Date): ErrorGroupFilter {
  const value = objectValue(raw)
  const range = parseDateRange(value, now)
  let status: ErrorGroupFilter['status']
  if (value.status !== undefined) {
    if (!isErrorStatus(value.status)) throw httpError(400, 'invalid_error_query', 'Error status is invalid')
    status = value.status
  }
  let release: string | undefined
  if (value.release !== undefined) {
    if (typeof value.release !== 'string' || value.release.length < 1 || value.release.length > 200) throw httpError(400, 'invalid_error_query', 'Error release is invalid')
    release = value.release
  }
  return { ...scope, ...range, status, release, cursor: parseCursor(value.cursor), limit: parseLimit(value.limit) }
}

function parseDateRange(raw: unknown, now: Date): { from: Date; to: Date } {
  const value = objectValue(raw)
  const to = value.to === undefined ? now : parseDate(value.to)
  const from = value.from === undefined ? new Date(to.getTime() - DEFAULT_RANGE) : parseDate(value.from)
  if (from >= to || to.getTime() > now.getTime() + 5 * 60_000 || to.getTime() - from.getTime() > MAX_RANGE) {
    throw httpError(400, 'invalid_error_query', 'Date range is invalid')
  }
  return { from, to }
}

function parseDate(value: unknown): Date {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) throw httpError(400, 'invalid_error_query', 'Date range is invalid')
  return new Date(value)
}

function parseCursor(value: unknown): ErrorCursor | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 300) throw httpError(400, 'invalid_error_cursor', 'Error cursor is invalid')
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    const cursor = parsed as { occurred_at?: unknown; id?: unknown }
    if (typeof cursor.occurred_at !== 'string' || !Number.isFinite(Date.parse(cursor.occurred_at)) || !isUuid(cursor.id)) throw new Error('invalid')
    return { occurredAt: new Date(cursor.occurred_at), id: cursor.id }
  } catch { throw httpError(400, 'invalid_error_cursor', 'Error cursor is invalid') }
}

function cursorFor(occurredAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ occurred_at: occurredAt.toISOString(), id }), 'utf8').toString('base64url')
}

function parseLimit(value: unknown): number {
  if (value === undefined) return PAGE_SIZE
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) throw httpError(400, 'invalid_error_query', 'Page limit is invalid')
  return parsed
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}
function ensureUuid(value: unknown, code: string, message: string): asserts value is string { if (!isUuid(value)) throw httpError(404, code, message) }
function page<T, D>(rows: T[], limit: number, dto: (record: T) => D, cursor: (record: T) => string): { items: D[]; next_cursor: string | null } {
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit)
  return { items: items.map(dto), next_cursor: hasMore && items.length ? cursor(items[items.length - 1]!) : null }
}
function groupDto(record: ErrorGroupRecord): ErrorGroupDto {
  return { id: record.id, status: record.status, type: record.type, display_message: record.display_message, release: record.release,
    first_seen: record.first_seen.toISOString(), last_seen: record.last_seen.toISOString(), occurrence_count: Number(record.occurrence_count),
    resolved_at: record.resolved_at?.toISOString() ?? null, state_version: record.state_version }
}
function occurrenceDto(record: ErrorOccurrenceDetailRecord, frames: unknown = record.frames): ErrorOccurrenceDto {
  return { id: record.id, client_event_id: record.client_event_id, occurred_at: record.occurred_at.toISOString(), received_at: record.received_at.toISOString(),
    visitor_id: record.visitor_id, business_user_id: record.business_user_id, release: record.release, dist: record.dist, replay_session_id: record.replay_session_id,
    url: record.url, route: record.route, browser: record.browser, device: record.device, mechanism: record.mechanism, stack: record.stack, frames }
}
function generatedFrames(value: unknown): GeneratedErrorFrame[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeErrorFrame).filter((frame): frame is GeneratedErrorFrame => frame !== null).slice(0, 40)
}
function historyDto(record: ErrorStateHistoryRecord) { return { id: record.id, from_status: record.from_status, to_status: record.to_status, actor_user_id: record.actor_user_id, reason: record.reason, occurred_at: record.occurred_at.toISOString() } }
function snapshotDto(snapshot: { group_id: string; status: string; resolved_at: Date | null; state_version: number }) { return { group_id: snapshot.group_id, status: snapshot.status, resolved_at: snapshot.resolved_at?.toISOString() ?? null, state_version: snapshot.state_version } }
