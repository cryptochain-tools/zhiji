import { httpError } from '../../lib/http'

export interface ReportScheduleScope { tenantId: string; projectId: string }
export type ReportTargetType = 'insight' | 'dashboard'
export type ReportCadence = 'daily' | 'weekly' | 'monthly'
export interface ReportScheduleInput {
  targetType: ReportTargetType; targetId: string; cadence: ReportCadence; timezone: string
  nextRunAt: Date; enabled: boolean; notificationTargetId: string
}
export interface ReportSchedulePatch {
  expectedUpdatedAt: Date
  targetType?: ReportTargetType; targetId?: string; cadence?: ReportCadence; timezone?: string
  nextRunAt?: Date; enabled?: boolean; notificationTargetId?: string
}
export interface ReportScheduleListQuery { limit: number; cursor?: { createdAt: Date; id: string } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseCreateSchedule(raw: unknown, now = new Date()): ReportScheduleInput {
  const value = object(raw)
  only(value, [ 'target_type', 'target_id', 'cadence', 'timezone', 'next_run_at', 'enabled', 'notification_target_id' ])
  return {
    targetType: targetType(value.target_type), targetId: uuid(value.target_id, 'invalid_report_schedule'),
    cadence: cadence(value.cadence), timezone: timezone(value.timezone), nextRunAt: futureDate(value.next_run_at, now),
    enabled: value.enabled === undefined ? false : boolean(value.enabled),
    notificationTargetId: uuid(value.notification_target_id, 'invalid_report_schedule'),
  }
}

export function parsePatchSchedule(raw: unknown, now = new Date()): ReportSchedulePatch {
  const value = object(raw)
  only(value, [ 'expected_updated_at', 'target_type', 'target_id', 'cadence', 'timezone', 'next_run_at', 'enabled', 'notification_target_id' ])
  const expectedUpdatedAt = pastOrPresentDate(value.expected_updated_at, now)
  const patch: ReportSchedulePatch = { expectedUpdatedAt }
  if ('target_type' in value) patch.targetType = targetType(value.target_type)
  if ('target_id' in value) patch.targetId = uuid(value.target_id, 'invalid_report_schedule')
  if ((patch.targetType === undefined) !== (patch.targetId === undefined)) throw httpError(400, 'invalid_report_schedule', 'target_type and target_id must be changed together')
  if ('cadence' in value) patch.cadence = cadence(value.cadence)
  if ('timezone' in value) patch.timezone = timezone(value.timezone)
  if ('next_run_at' in value) patch.nextRunAt = futureDate(value.next_run_at, now)
  if ('enabled' in value) patch.enabled = boolean(value.enabled)
  if ('notification_target_id' in value) patch.notificationTargetId = uuid(value.notification_target_id, 'invalid_report_schedule')
  if (Object.keys(patch).length === 1) throw httpError(400, 'invalid_report_schedule', 'No schedule changes were supplied')
  return patch
}
export function parseDisableSchedule(raw: unknown, now = new Date()): Date {
  const value = object(raw)
  only(value, [ 'expected_updated_at' ])
  return pastOrPresentDate(value.expected_updated_at, now)
}

export function parseScheduleListQuery(raw: unknown): ReportScheduleListQuery {
  const value = object(raw)
  const limit = value.limit === undefined ? 50 : integer(value.limit, 1, 100)
  if (value.cursor === undefined) return { limit }
  if (typeof value.cursor !== 'string') throw httpError(400, 'invalid_report_schedule_query', 'Report schedule cursor is invalid')
  const decoded = Buffer.from(value.cursor, 'base64url').toString('utf8').split('|')
  const createdAt = decoded[0] ? new Date(decoded[0]) : new Date('invalid')
  if (decoded.length !== 2 || !Number.isFinite(createdAt.getTime()) || !decoded[1] || !UUID.test(decoded[1])) throw httpError(400, 'invalid_report_schedule_query', 'Report schedule cursor is invalid')
  return { limit, cursor: { createdAt, id: decoded[1] } }
}
export function scheduleCursor(createdAt: Date, id: string): string { return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url') }

function object(raw: unknown): Record<string, unknown> { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, 'invalid_report_schedule', 'Report schedule is invalid'); return raw as Record<string, unknown> }
function only(value: Record<string, unknown>, fields: readonly string[]) { if (Object.keys(value).some(key => !fields.includes(key))) throw httpError(400, 'invalid_report_schedule', 'Report schedule is invalid') }
function targetType(value: unknown): ReportTargetType { if (value !== 'insight' && value !== 'dashboard') throw httpError(400, 'invalid_report_schedule', 'Report target type is invalid'); return value }
function cadence(value: unknown): ReportCadence { if (value !== 'daily' && value !== 'weekly' && value !== 'monthly') throw httpError(400, 'invalid_report_schedule', 'Report cadence is invalid'); return value }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw httpError(400, 'invalid_report_schedule', 'Report schedule enabled is invalid'); return value }
function uuid(value: unknown, code: string): string { if (typeof value !== 'string' || !UUID.test(value)) throw httpError(400, code, 'Report schedule identifier is invalid'); return value }
function integer(value: unknown, min: number, max: number): number { if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw httpError(400, 'invalid_report_schedule_query', 'Report schedule query is invalid'); return Number(value) }
function timezone(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100 || value.trim() !== value) throw httpError(400, 'invalid_report_schedule', 'Report timezone is invalid')
  try { Intl.DateTimeFormat('en-US', { timeZone: value }).format() } catch { throw httpError(400, 'invalid_report_schedule', 'Report timezone is invalid') }
  return value
}
function date(value: unknown): Date { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw httpError(400, 'invalid_report_schedule', 'Report schedule time is invalid'); return new Date(value) }
function futureDate(value: unknown, now: Date): Date { const parsed = date(value); if (parsed.getTime() <= now.getTime() || parsed.getTime() > now.getTime() + 400 * 86_400_000) throw httpError(400, 'invalid_report_schedule', 'next_run_at must be in the next 400 days'); return parsed }
function pastOrPresentDate(value: unknown, now: Date): Date { const parsed = date(value); if (parsed.getTime() > now.getTime() + 300_000) throw httpError(400, 'invalid_report_schedule', 'expected_updated_at is invalid'); return parsed }
