import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { isUuid } from '../tenancy'
import { parseCreateSchedule, parseDisableSchedule, parsePatchSchedule, parseScheduleListQuery, ReportScheduleScope, scheduleCursor } from './contracts'
import { ReportScheduleRecord, ReportSchedulesRepository } from './repository'

export class ReportSchedulesManagementService {
  constructor(private readonly database: import('../database/types').DatabaseClient) {}
  async create(scope: ReportScheduleScope, actorId: string, raw: unknown) {
    const schedule = await new ReportSchedulesRepository(this.database).create(scope, actorId, parseCreateSchedule(raw))
    if (!schedule) throw httpError(404, 'resource_not_found', 'Report target or notification target was not found')
    return dto(schedule)
  }
  async list(scope: ReportScheduleScope, raw: unknown) { const query = parseScheduleListQuery(raw); const rows = await new ReportSchedulesRepository(this.database).list(scope, query); const items = rows.slice(0, query.limit); const last = items.at(-1); return { items: items.map(dto), next_cursor: rows.length > query.limit && last ? scheduleCursor(last.created_at, last.id) : null } }
  async show(scope: ReportScheduleScope, id: unknown) { const schedule = await new ReportSchedulesRepository(this.database).find(scope, resourceId(id)); if (!schedule) throw httpError(404, 'resource_not_found', 'Report schedule was not found'); return dto(schedule) }
  async update(scope: ReportScheduleScope, id: unknown, actorId: string, raw: unknown) { const schedule = await new ReportSchedulesRepository(this.database).update(scope, resourceId(id), actorId, parsePatchSchedule(raw)); if (!schedule) throw httpError(409, 'schedule_state_conflict', 'Report schedule changed or a referenced target is unavailable'); return dto(schedule) }
  async disable(scope: ReportScheduleScope, id: unknown, actorId: string, raw: unknown) { const schedule = await new ReportSchedulesRepository(this.database).disable(scope, resourceId(id), actorId, parseDisableSchedule(raw)); if (!schedule) throw httpError(409, 'schedule_state_conflict', 'Report schedule changed or is already disabled'); return dto(schedule) }
  async retryRun(scope: ReportScheduleScope, scheduleId: unknown, runId: unknown, actorId: string) { const result = await new ReportSchedulesRepository(this.database).retryRun(scope, resourceId(scheduleId), resourceId(runId), actorId); if (!result) throw httpError(409, 'report_run_retry_conflict', 'Report run is unavailable for retry'); return { run_id: result.id, status: 'queued' as const, retry_count: result.retry_count } }
}
export default class ReportSchedulesService extends Service {
  private domain(): ReportSchedulesManagementService { const database = this.config.zhiji.database; if (!database?.configured) throw httpError(503, 'report_schedules_unavailable', 'Report schedules are unavailable'); return new ReportSchedulesManagementService(database) }
  create(scope: ReportScheduleScope, actorId: string, raw: unknown) { return this.domain().create(scope, actorId, raw) }
  list(scope: ReportScheduleScope, raw: unknown) { return this.domain().list(scope, raw) }
  show(scope: ReportScheduleScope, id: unknown) { return this.domain().show(scope, id) }
  update(scope: ReportScheduleScope, id: unknown, actorId: string, raw: unknown) { return this.domain().update(scope, id, actorId, raw) }
  disable(scope: ReportScheduleScope, id: unknown, actorId: string, raw: unknown) { return this.domain().disable(scope, id, actorId, raw) }
  retryRun(scope: ReportScheduleScope, scheduleId: unknown, runId: unknown, actorId: string) { return this.domain().retryRun(scope, scheduleId, runId, actorId) }
}
function resourceId(value: unknown): string { if (!isUuid(value)) throw httpError(404, 'resource_not_found', 'Report schedule was not found'); return value }
function dto(value: ReportScheduleRecord) { return { id: value.id, target_type: value.target_type, target_id: value.target_id, cadence: value.cadence, timezone: value.timezone, next_run_at: value.next_run_at.toISOString(), enabled: value.enabled, notification_target_id: value.notification_target_id, created_by: value.created_by, updated_by: value.updated_by, created_at: value.created_at.toISOString(), updated_at: value.updated_at.toISOString(), latest_run: value.latest_run_id ? { id: value.latest_run_id, status: value.latest_run_status, scheduled_for: value.latest_run_scheduled_for?.toISOString() ?? null, finished_at: value.latest_run_finished_at?.toISOString() ?? null, error_code: value.latest_run_error_code } : null } }
