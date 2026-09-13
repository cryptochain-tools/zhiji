import { randomUUID } from 'node:crypto'
import { DatabaseClient } from '../database/types'
import { ReportCadence, ReportScheduleInput, ReportScheduleListQuery, ReportSchedulePatch, ReportScheduleScope, ReportTargetType } from './contracts'

export interface ReportScheduleRecord {
  id: string; target_type: ReportTargetType; target_id: string; cadence: ReportCadence; timezone: string; next_run_at: Date; enabled: boolean; notification_target_id: string
  created_by: string; updated_by: string; created_at: Date; updated_at: Date; latest_run_id: string | null; latest_run_status: string | null; latest_run_scheduled_for: Date | null; latest_run_finished_at: Date | null; latest_run_error_code: string | null
}

export class ReportSchedulesRepository {
  constructor(private readonly database: DatabaseClient) {}
  async create(scope: ReportScheduleScope, actorId: string, input: ReportScheduleInput): Promise<ReportScheduleRecord | null> {
    return this.insertOrUpdate(scope, actorId, input, null)
  }
  async update(scope: ReportScheduleScope, id: string, actorId: string, patch: ReportSchedulePatch): Promise<ReportScheduleRecord | null> {
    const current = await this.database.query<Pick<ReportScheduleRecord, 'target_type' | 'target_id' | 'cadence' | 'timezone' | 'next_run_at' | 'enabled' | 'notification_target_id'>>(
      `SELECT target_type, target_id, cadence, timezone, next_run_at, enabled, notification_target_id
       FROM report_schedules WHERE tenant_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`, [ scope.tenantId, scope.projectId, id ],
    )
    const row = current.rows[0]
    if (!row) return null
    const input: ReportScheduleInput = {
      targetType: patch.targetType ?? row.target_type, targetId: patch.targetId ?? row.target_id, cadence: patch.cadence ?? row.cadence,
      timezone: patch.timezone ?? row.timezone, nextRunAt: patch.nextRunAt ?? row.next_run_at, enabled: patch.enabled ?? row.enabled,
      notificationTargetId: patch.notificationTargetId ?? row.notification_target_id,
    }
    return this.insertOrUpdate(scope, actorId, input, { id, expectedUpdatedAt: patch.expectedUpdatedAt })
  }
  async list(scope: ReportScheduleScope, query: ReportScheduleListQuery): Promise<ReportScheduleRecord[]> {
    const values: unknown[] = [ scope.tenantId, scope.projectId ]
    const clauses = [ 'schedule.tenant_id = $1', 'schedule.project_id = $2' ]
    if (query.cursor) { values.push(query.cursor.createdAt, query.cursor.id); clauses.push(`(schedule.created_at, schedule.id) < ($${values.length - 1}, $${values.length})`) }
    values.push(query.limit + 1)
    return this.rows(`WHERE ${clauses.join(' AND ')} ORDER BY schedule.created_at DESC, schedule.id DESC LIMIT $${values.length}`, values)
  }
  async find(scope: ReportScheduleScope, id: string): Promise<ReportScheduleRecord | null> { return (await this.rows('WHERE schedule.tenant_id = $1 AND schedule.project_id = $2 AND schedule.id = $3', [ scope.tenantId, scope.projectId, id ]))[0] ?? null }
  async disable(scope: ReportScheduleScope, id: string, actorId: string, expectedUpdatedAt: Date): Promise<ReportScheduleRecord | null> {
    const result = await this.database.query<{ id: string }>(
      `UPDATE report_schedules SET enabled = false, updated_by = $4,
         updated_at = GREATEST(date_trunc('milliseconds', now()), date_trunc('milliseconds', updated_at) + interval '1 millisecond')
       WHERE tenant_id = $1 AND project_id = $2 AND id = $3 AND date_trunc('milliseconds', updated_at) = $5 AND enabled RETURNING id`,
      [ scope.tenantId, scope.projectId, id, actorId, expectedUpdatedAt ],
    )
    return result.rows[0] ? this.find(scope, id) : null
  }
  async retryRun(scope: ReportScheduleScope, scheduleId: string, runId: string, actorId: string): Promise<{ id: string; retry_count: number } | null> {
    const result = await this.database.query<{ id: string; retry_count: number }>(
      `WITH retried AS (UPDATE report_runs run SET status='queued',error_code=NULL,started_at=NULL,finished_at=NULL,retry_count=retry_count+1
         FROM report_schedules schedule JOIN notification_targets target ON target.id=schedule.notification_target_id AND target.tenant_id=schedule.tenant_id AND target.project_id=schedule.project_id AND target.enabled AND target.verified_at IS NOT NULL AND target.disabled_at IS NULL
         JOIN projects project ON project.id=schedule.project_id AND project.tenant_id=schedule.tenant_id AND project.deletion_status='active'
         WHERE run.id=$4 AND run.schedule_id=$3 AND run.tenant_id=$1 AND run.project_id=$2 AND schedule.id=$3 AND schedule.tenant_id=$1 AND schedule.project_id=$2 AND schedule.enabled AND run.status='failed' AND run.retry_count<3 RETURNING run.id,run.retry_count),
       job AS (INSERT INTO worker_jobs (id,tenant_id,project_id,kind,idempotency_key,payload,max_attempts) SELECT $5,$1,$2,'report_schedule_run','report-schedule-retry:'||id||':'||retry_count::text,jsonb_build_object('report_run_id',id),3 FROM retried ON CONFLICT(tenant_id,project_id,kind,idempotency_key) DO NOTHING RETURNING id),
       audit AS (INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,metadata) SELECT $6,$1,$7,'report_run_retried','report_run',id,jsonb_build_object('retry_count',retry_count) FROM retried) SELECT id,retry_count FROM retried`,
      [ scope.tenantId, scope.projectId, scheduleId, runId, randomUUID(), randomUUID(), actorId ],
    )
    return result.rows[0] ?? null
  }
  private async insertOrUpdate(scope: ReportScheduleScope, actorId: string, input: ReportScheduleInput, update: { id: string; expectedUpdatedAt: Date } | null): Promise<ReportScheduleRecord | null> {
    const id = update?.id ?? randomUUID()
    const result = await this.database.query<{ id: string }>(
      `WITH valid_target AS (
         SELECT id FROM notification_targets WHERE tenant_id = $1 AND project_id = $2 AND id = $8 AND enabled AND verified_at IS NOT NULL
       ), valid_report_target AS (
         SELECT id FROM saved_insights WHERE tenant_id = $1 AND project_id = $2 AND id = $4 AND archived_at IS NULL AND visibility = 'project' AND $3 = 'insight'
         UNION ALL
         SELECT id FROM dashboards WHERE tenant_id = $1 AND project_id = $2 AND id = $4 AND archived_at IS NULL AND $3 = 'dashboard'
       ), changed AS (
         ${update
           ? `UPDATE report_schedules SET target_type = $3, target_id = $4, cadence = $5, timezone = $6, next_run_at = $7, enabled = $9, notification_target_id = $8, updated_by = $10,
                updated_at = GREATEST(date_trunc('milliseconds', now()), date_trunc('milliseconds', updated_at) + interval '1 millisecond')
              WHERE tenant_id = $1 AND project_id = $2 AND id = $11 AND date_trunc('milliseconds', updated_at) = $12 AND EXISTS (SELECT 1 FROM valid_target) AND EXISTS (SELECT 1 FROM valid_report_target) RETURNING id`
           : `INSERT INTO report_schedules (id, tenant_id, project_id, target_type, target_id, cadence, timezone, next_run_at, enabled, notification_target_id, created_by, updated_by)
              SELECT $11, $1, $2, $3, $4, $5, $6, $7, $9, $8, $10, $10 WHERE EXISTS (SELECT 1 FROM valid_target) AND EXISTS (SELECT 1 FROM valid_report_target) RETURNING id`}
       ) SELECT id FROM changed`,
      update
        ? [ scope.tenantId, scope.projectId, input.targetType, input.targetId, input.cadence, input.timezone, input.nextRunAt, input.notificationTargetId, input.enabled, actorId, id, update.expectedUpdatedAt ]
        : [ scope.tenantId, scope.projectId, input.targetType, input.targetId, input.cadence, input.timezone, input.nextRunAt, input.notificationTargetId, input.enabled, actorId, id ],
    )
    return result.rows[0] ? this.find(scope, id) : null
  }
  private async rows(suffix: string, values: readonly unknown[]): Promise<ReportScheduleRecord[]> {
    const result = await this.database.query<ReportScheduleRecord>(
      `SELECT schedule.id, schedule.target_type, schedule.target_id, schedule.cadence, schedule.timezone, schedule.next_run_at, schedule.enabled, schedule.notification_target_id,
              schedule.created_by, schedule.updated_by, schedule.created_at, schedule.updated_at,
              recent.id AS latest_run_id, recent.status AS latest_run_status, recent.scheduled_for AS latest_run_scheduled_for, recent.finished_at AS latest_run_finished_at, recent.error_code AS latest_run_error_code
       FROM report_schedules AS schedule
       LEFT JOIN LATERAL (SELECT id, status, scheduled_for, finished_at, error_code FROM report_runs WHERE schedule_id = schedule.id ORDER BY scheduled_for DESC, id DESC LIMIT 1) AS recent ON true
       ${suffix}`,
      values,
    )
    return result.rows
  }
}
