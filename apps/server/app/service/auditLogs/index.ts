import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { DatabaseClient } from '../database/types'
import { isUuid } from '../tenancy'
import { AuditLogCursor, AuditLogFilter, AuditLogRecord, AuditLogScope } from './contracts'
import { AuditLogRepository } from './repository'

const DAY = 24 * 60 * 60 * 1000
const DEFAULT_RANGE = 30 * DAY
const MAX_RANGE = 90 * DAY
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export interface AuditLogDto {
  id: string
  action: string
  target_type: string
  target_id: string
  actor_user_id: string | null
  created_at: string
}

export class AuditLogManagementService {
  constructor(private readonly database: DatabaseClient) {}

  async list(scope: AuditLogScope, raw: unknown, now = new Date()): Promise<{ items: AuditLogDto[]; next_cursor: string | null }> {
    const filter = parseFilter(scope, raw, now)
    const rows = await new AuditLogRepository(this.database).list(filter)
    const items = rows.slice(0, filter.limit).map(project)
    return {
      items,
      next_cursor: rows.length > filter.limit && items.length
        ? cursorFor(rows[filter.limit - 1]!)
        : null,
    }
  }
}

export default class AuditLogsService extends Service {
  list(scope: AuditLogScope, raw: unknown) {
    const database = this.config.zhiji.database
    if (!database?.configured) throw httpError(503, 'audit_logs_unavailable', 'Audit log management is unavailable')
    return new AuditLogManagementService(database).list(scope, raw)
  }
}

function parseFilter(scope: AuditLogScope, raw: unknown, now: Date): AuditLogFilter {
  const value = objectValue(raw)
  const allowed = new Set([ 'from', 'to', 'action', 'target_type', 'cursor', 'limit' ])
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw httpError(400, 'invalid_audit_log_query', 'Audit log query is invalid')
  }
  const to = value.to === undefined ? now : date(value.to)
  const from = value.from === undefined ? new Date(to.getTime() - DEFAULT_RANGE) : date(value.from)
  if (from >= to || to.getTime() > now.getTime() + 5 * 60_000 || to.getTime() - from.getTime() > MAX_RANGE) {
    throw httpError(400, 'invalid_audit_log_query', 'Audit log date range is invalid')
  }
  return {
    ...scope,
    from,
    to,
    action: boundedExactFilter(value.action, 'action'),
    targetType: boundedExactFilter(value.target_type, 'target type'),
    cursor: parseCursor(value.cursor),
    limit: parseLimit(value.limit),
  }
}

function boundedExactFilter(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) throw httpError(400, 'invalid_audit_log_query', `Audit log ${field} is invalid`)
  return value
}

function date(value: unknown): Date {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) throw httpError(400, 'invalid_audit_log_query', 'Audit log date range is invalid')
  return new Date(value)
}

function parseCursor(value: unknown): AuditLogCursor | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 300) throw httpError(400, 'invalid_audit_log_cursor', 'Audit log cursor is invalid')
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    const cursor = parsed as { created_at?: unknown; id?: unknown }
    if (typeof cursor.created_at !== 'string' || !Number.isFinite(Date.parse(cursor.created_at)) || !isUuid(cursor.id)) throw new Error('invalid')
    return { createdAt: new Date(cursor.created_at), id: cursor.id }
  } catch { throw httpError(400, 'invalid_audit_log_cursor', 'Audit log cursor is invalid') }
}

function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) throw httpError(400, 'invalid_audit_log_query', 'Audit log limit is invalid')
  return parsed
}

function cursorFor(row: AuditLogRecord): string {
  return Buffer.from(JSON.stringify({ created_at: row.created_at.toISOString(), id: row.id }), 'utf8').toString('base64url')
}

function project(row: AuditLogRecord): AuditLogDto {
  return { id: row.id, action: row.action, target_type: row.target_type, target_id: row.target_id, actor_user_id: row.actor_user_id, created_at: row.created_at.toISOString() }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
