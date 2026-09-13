import { randomUUID } from 'node:crypto'
import { DatabaseClient, PostgreSqlConnection } from '../../server/app/service/database/types'
import { LeasedWorkerJob, WorkerHandlers } from '../../server/app/service/worker'
import { PrivateReplayArtifactStore } from '../../server/app/service/replay/artifacts'
import { PrivateExportArtifactStore } from '../../server/app/service/reporting/artifacts'
import { removeReplayArtifacts } from './replay-artifacts'
import { legacyDataLifecyclePolicy, parseDataLifecyclePolicy } from '../../server/app/service/lifecycle/policy'

type TransactionDriver = DatabaseClient & { connect(): Promise<PostgreSqlConnection> }

type SubjectRow = {
  id: string
  requested_by: string
  subject_business_user_id: string
  status: string
  expires_at: Date
}

type ProjectDeletionRow = { id: string; requested_by: string; status: string; effective_at: Date }
const DELETE_BATCH_SIZE = 1_000

/**
 * Durable lifecycle handlers.  They deliberately use one database transaction
 * per request: a tombstone, fact deletion, lifecycle state and audit record
 * either become visible together or none of them do.  No deletion backup is
 * represented as a completed export; an artifact store must be configured
 * before a subject export can ever complete.
 */
export class LifecycleJobHandlers implements Pick<WorkerHandlers, 'runJob'> {
  constructor(
    private readonly database: TransactionDriver,
    private readonly replayArtifacts?: PrivateReplayArtifactStore,
    private readonly exportArtifacts?: PrivateExportArtifactStore,
  ) {}

  async runJob(job: LeasedWorkerJob): Promise<{ processedCount: number; failedCount: number; watermark?: Record<string, unknown> }> {
    switch (job.kind) {
      case 'subject_deletion': return this.subjectDeletion(job)
      case 'project_deletion': return this.projectDeletion(job)
      case 'subject_export': return this.subjectExport(job)
      case 'artifact_cleanup': return this.expireSubjectExports(job)
      default: throw new Error(`unsupported_worker_job:${job.kind}`)
    }
  }

  private async subjectExport(job: LeasedWorkerJob) {
    const requestId = requiredUuid(job.payload.data_subject_job_id, 'data_subject_job_id')
    if (!this.exportArtifacts) return this.failSubjectExport(job, requestId, 'artifact_store_unavailable')
    return this.transaction(async transaction => {
      const request = await this.subjectRequest(transaction, job, requestId, 'subject_export')
      if (!request) throw new Error('data_subject_request_not_found')
      if (request.status === 'completed') return { processedCount: 0, failedCount: 0, watermark: { already_completed: true } }
      if (terminal(request.status)) return { processedCount: 0, failedCount: 0, watermark: { terminal_status: request.status } }
      if (request.expires_at.getTime() <= Date.now()) {
        await transaction.query("UPDATE data_subject_jobs SET status = 'expired', finished_at = now(), reason_code = 'request_expired' WHERE id = $1 AND status IN ('queued', 'running')", [ request.id ])
        await audit(transaction, job.tenant_id, request.requested_by, 'subject_export_expired', 'data_subject_job', request.id, {})
        return { processedCount: 0, failedCount: 1, watermark: { terminal_reason: 'request_expired' } }
      }
      await this.assertProjectActive(transaction, job)
      await transaction.query("UPDATE data_subject_jobs SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1 AND status IN ('queued', 'running')", [ request.id ])
      let artifact: { ref: string; byteCount: number } | null = null
      try {
        const contents = await renderSubjectExport(transaction, job, request)
        artifact = await this.exportArtifacts!.put({ tenantId: job.tenant_id, projectId: job.project_id, jobId: request.id, format: 'json', contents, kind: 'subject-export' })
        const completed = await transaction.query(
          `UPDATE data_subject_jobs SET status = 'completed', artifact_ref = $2, byte_count = $3, finished_at = now(), reason_code = NULL
           WHERE id = $1 AND status = 'running' AND expires_at > now()`,
          [ request.id, artifact.ref, artifact.byteCount ],
        )
        if (completed.rowCount !== 1) {
          await this.exportArtifacts!.remove(artifact.ref)
          return { processedCount: 0, failedCount: 0, watermark: { skipped: 'request_state_changed' } }
        }
        await audit(transaction, job.tenant_id, request.requested_by, 'subject_export_completed', 'data_subject_job', request.id,
          { byte_count: artifact.byteCount })
        return { processedCount: 1, failedCount: 0, watermark: { data_subject_job_id: request.id, byte_count: artifact.byteCount } }
      } catch (error) {
        if (artifact) await this.exportArtifacts!.remove(artifact.ref)
        const reason = subjectExportErrorCode(error)
        await transaction.query(
          "UPDATE data_subject_jobs SET status = 'failed', finished_at = now(), reason_code = $2 WHERE id = $1 AND status IN ('queued', 'running')",
          [ request.id, reason ],
        )
        await audit(transaction, job.tenant_id, request.requested_by, 'subject_export_failed', 'data_subject_job', request.id, { reason_code: reason })
        return { processedCount: 0, failedCount: 1, watermark: { terminal_reason: reason } }
      }
    })
  }

  private async failSubjectExport(job: LeasedWorkerJob, requestId: string, reason: string) {
    await this.transaction(async transaction => {
      const request = await this.subjectRequest(transaction, job, requestId, 'subject_export')
      if (!request) throw new Error('data_subject_request_not_found')
      if (terminal(request.status)) return
      await transaction.query(
        `UPDATE data_subject_jobs
         SET status = 'failed', finished_at = now(), reason_code = $2
         WHERE id = $1 AND status IN ('queued', 'running')`,
        [ request.id, reason ],
      )
      await audit(transaction, job.tenant_id, request.requested_by, 'subject_export_failed', 'data_subject_job', request.id,
        { reason_code: reason })
    })
    // This is a terminal, intentionally failed request. Returning successfully
    // prevents a retry loop that could accidentally manufacture a download.
    return { processedCount: 0, failedCount: 1, watermark: { terminal_reason: reason } }
  }

  private async subjectDeletion(job: LeasedWorkerJob) {
    const requestId = requiredUuid(job.payload.data_subject_job_id, 'data_subject_job_id')
    return this.transaction(async transaction => {
      const request = await this.subjectRequest(transaction, job, requestId, 'subject_deletion')
      if (!request) throw new Error('data_subject_request_not_found')
      if (request.status === 'completed') return { processedCount: 0, failedCount: 0, watermark: { already_completed: true } }
      if (terminal(request.status)) return { processedCount: 0, failedCount: 0, watermark: { terminal_status: request.status } }
      if (request.expires_at.getTime() <= Date.now()) {
        await transaction.query("UPDATE data_subject_jobs SET status = 'expired', finished_at = now(), reason_code = 'request_expired' WHERE id = $1", [ request.id ])
        await audit(transaction, job.tenant_id, request.requested_by, 'subject_deletion_expired', 'data_subject_job', request.id, {})
        return { processedCount: 0, failedCount: 1, watermark: { terminal_reason: 'request_expired' } }
      }
      await this.assertProjectActive(transaction, job)
      await transaction.query("UPDATE data_subject_jobs SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1", [ request.id ])
      const backupExpiryDays = await this.backupExpiryDays(transaction, job)
      await transaction.query(
        `INSERT INTO deletion_tombstones
           (id, tenant_id, project_id, subject_business_user_id, deletion_job_id, backup_expiry_at)
         VALUES ($1,$2,$3,$4,$5,now() + ($6::integer * interval '1 day'))
         ON CONFLICT (tenant_id, project_id, subject_business_user_id) WHERE subject_business_user_id IS NOT NULL DO NOTHING`,
        [ randomUUID(), job.tenant_id, job.project_id, request.subject_business_user_id, job.id, backupExpiryDays ],
      )
      // Subject deletion breaks only this verified identity relationship. Facts
      // remain keyed by visitor/client event so a visitor with other verified
      // identities is neither erased nor double-counted after anonymization.
      const removed = await anonymizeSubjectFacts(transaction, job.tenant_id, job.project_id, request.subject_business_user_id)
      await transaction.query(
        "UPDATE data_subject_jobs SET status = 'completed', finished_at = now(), reason_code = NULL WHERE id = $1 AND status = 'running'",
        [ request.id ],
      )
      await audit(transaction, job.tenant_id, request.requested_by, 'subject_deletion_completed', 'data_subject_job', request.id,
        { records_removed: removed })
      return { processedCount: removed, failedCount: 0, watermark: { data_subject_job_id: request.id } }
    })
  }

  private async expireSubjectExports(job: LeasedWorkerJob) {
    if (!this.exportArtifacts) return { processedCount: 0, failedCount: 0, watermark: { skipped: 'artifact_store_unavailable' } }
    return this.transaction(async transaction => {
      const rows = await transaction.query<{ id: string; artifact_ref: string }>(
        `SELECT id, artifact_ref FROM data_subject_jobs
         WHERE tenant_id=$1 AND project_id=$2 AND kind='subject_export' AND status='completed'
           AND expires_at<=now() AND artifact_ref IS NOT NULL
         ORDER BY expires_at ASC, id ASC FOR UPDATE SKIP LOCKED LIMIT $3`,
        [ job.tenant_id, job.project_id, DELETE_BATCH_SIZE ],
      )
      let removed = 0
      for (const row of rows.rows) {
        await this.exportArtifacts!.remove(row.artifact_ref)
        const result = await transaction.query(
          `UPDATE data_subject_jobs SET status='expired', artifact_ref=NULL, byte_count=NULL,
             finished_at=COALESCE(finished_at, now()), reason_code='export_expired'
           WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND status='completed' AND artifact_ref=$4`,
          [ row.id, job.tenant_id, job.project_id, row.artifact_ref ],
        )
        removed += result.rowCount ?? 0
      }
      return { processedCount: removed, failedCount: 0, watermark: { expired_subject_exports: removed, has_more: rows.rowCount === DELETE_BATCH_SIZE } }
    })
  }

  private async projectDeletion(job: LeasedWorkerJob) {
    const requestId = requiredUuid(job.payload.project_deletion_request_id, 'project_deletion_request_id')
    return this.transaction(async transaction => {
      const result = await transaction.query<ProjectDeletionRow>(
        `SELECT id, requested_by, status, effective_at FROM project_deletion_requests
         WHERE id = $1 AND tenant_id = $2 AND project_id = $3 FOR UPDATE`,
        [ requestId, job.tenant_id, job.project_id ],
      )
      const request = result.rows[0]
      if (!request) throw new Error('project_deletion_request_not_found')
      if (request.status === 'completed') return { processedCount: 0, failedCount: 0, watermark: { already_completed: true } }
      if (request.status === 'cancelled' || request.status === 'failed') return { processedCount: 0, failedCount: 0, watermark: { terminal_status: request.status } }
      if (request.effective_at.getTime() > Date.now()) throw new Error('project_deletion_not_effective')

      const freezing = await transaction.query(
        "UPDATE projects SET deletion_status = 'deleting', updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deletion_status IN ('pending', 'deleting')",
        [ job.tenant_id, job.project_id ],
      )
      if (freezing.rowCount !== 1) throw new Error('project_deletion_state_invalid')
      await transaction.query("UPDATE project_deletion_requests SET status = 'running' WHERE id = $1 AND status IN ('pending', 'queued', 'running')", [ request.id ])
      await transaction.query(
        'UPDATE project_keys SET disabled_at = COALESCE(disabled_at, now()) WHERE tenant_id = $1 AND project_id = $2',
        [ job.tenant_id, job.project_id ],
      )
      const backupExpiryDays = await this.backupExpiryDays(transaction, job)
      await transaction.query(
        `INSERT INTO deletion_tombstones (id, tenant_id, project_id, project_deletion, deletion_job_id, backup_expiry_at)
         VALUES ($1,$2,$3,true,$4,now() + ($5::integer * interval '1 day'))
         ON CONFLICT (tenant_id, project_id) WHERE project_deletion DO NOTHING`,
        [ randomUUID(), job.tenant_id, job.project_id, job.id, backupExpiryDays ],
      )
      // A concurrently claimed job checks the project lock/status before it
      // mutates facts. Queued work is made terminal here so it cannot restart.
      await transaction.query(
        `UPDATE worker_jobs SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, finished_at = now(),
                last_error_code = 'project_deleted', updated_at = now()
         WHERE tenant_id = $1 AND project_id = $2 AND id <> $3 AND status IN ('queued', 'running')`,
        [ job.tenant_id, job.project_id, job.id ],
      )
      await transaction.query(
        `UPDATE data_subject_jobs SET status = 'cancelled', finished_at = now(), reason_code = 'project_deleted'
         WHERE tenant_id = $1 AND project_id = $2 AND status IN ('queued', 'running')`,
        [ job.tenant_id, job.project_id ],
      )
      await transaction.query(
        `UPDATE outbox_messages SET discarded_at = now(), lease_owner = NULL, lease_expires_at = NULL,
                last_error_code = 'project_deleted', updated_at = now()
         WHERE tenant_id = $1 AND project_id = $2 AND delivered_at IS NULL AND discarded_at IS NULL`,
        [ job.tenant_id, job.project_id ],
      )
      const replayRemoved = await removeAllReplayArtifacts(transaction, this.replayArtifacts, { tenantId: job.tenant_id, projectId: job.project_id })
      const exportRemoved = await removeSubjectExportArtifacts(transaction, this.exportArtifacts, { tenantId: job.tenant_id, projectId: job.project_id })
      const removed = replayRemoved + exportRemoved + await deleteProjectFacts(transaction, job.tenant_id, job.project_id)
      await transaction.query(
        "UPDATE projects SET deletion_status = 'deleted', updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deletion_status = 'deleting'",
        [ job.tenant_id, job.project_id ],
      )
      await transaction.query("UPDATE project_deletion_requests SET status = 'completed' WHERE id = $1 AND status = 'running'", [ request.id ])
      await audit(transaction, job.tenant_id, request.requested_by, 'project_deletion_completed', 'project', job.project_id,
        { project_deletion_request_id: request.id, records_removed: removed })
      return { processedCount: removed, failedCount: 0, watermark: { project_deletion_request_id: request.id } }
    })
  }

  private async backupExpiryDays(database: DatabaseClient, job: LeasedWorkerJob): Promise<number> {
    const result = await database.query<{ data_lifecycle_policy: unknown; retention_days: number }>(
      `SELECT COALESCE(projects.data_lifecycle_policy, tenants.data_lifecycle_policy) AS data_lifecycle_policy,
              COALESCE(projects.retention_days, tenants.retention_days) AS retention_days
       FROM projects JOIN tenants ON tenants.id = projects.tenant_id
       WHERE projects.tenant_id = $1 AND projects.id = $2 FOR SHARE`,
      [ job.tenant_id, job.project_id ],
    )
    const row = result.rows[0]
    if (!row) throw new Error('project_not_found_for_backup_expiry')
    const configured = parseDataLifecyclePolicy(row.data_lifecycle_policy)
    if (row.data_lifecycle_policy !== null && row.data_lifecycle_policy !== undefined && !configured) throw new Error('invalid_project_data_lifecycle_policy')
    return (configured ?? legacyDataLifecyclePolicy(Number(row.retention_days))).backup_expiry_days
  }

  private async subjectRequest(transaction: DatabaseClient, job: LeasedWorkerJob, id: string, kind: 'subject_export' | 'subject_deletion'): Promise<SubjectRow | null> {
    const result = await transaction.query<SubjectRow>(
      `SELECT id, requested_by, subject_business_user_id, status, expires_at FROM data_subject_jobs
       WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND kind = $4 FOR UPDATE`,
      [ id, job.tenant_id, job.project_id, kind ],
    )
    return result.rows[0] ?? null
  }

  private async assertProjectActive(transaction: DatabaseClient, job: LeasedWorkerJob): Promise<void> {
    const result = await transaction.query<{ id: string }>(
      "SELECT id FROM projects WHERE tenant_id = $1 AND id = $2 AND deletion_status = 'active' FOR SHARE",
      [ job.tenant_id, job.project_id ],
    )
    if (result.rowCount !== 1) throw new Error('project_not_active')
  }

  private async transaction<T>(run: (transaction: PostgreSqlConnection) => Promise<T>): Promise<T> {
    const connection = await this.database.connect()
    try {
      await connection.query('BEGIN')
      const value = await run(connection)
      await connection.query('COMMIT')
      return value
    } catch (error) {
      try { await connection.query('ROLLBACK') } catch { /* preserve original failure */ }
      throw error
    } finally {
      connection.release()
    }
  }
}

export async function removeAllReplayArtifacts(database: DatabaseClient, artifacts: PrivateReplayArtifactStore | undefined, scope: { tenantId: string; projectId: string }): Promise<number> {
  let removed = 0
  while (true) {
    const count = await removeReplayArtifacts(database, artifacts, scope, DELETE_BATCH_SIZE)
    removed += count
    if (count < DELETE_BATCH_SIZE) return removed
  }
}

export async function removeSubjectExportArtifacts(database: DatabaseClient, artifacts: PrivateExportArtifactStore | undefined, scope: { tenantId: string; projectId: string }): Promise<number> {
  if (!artifacts) {
    const existing = await database.query<{ id: string }>(
      `SELECT id FROM data_subject_jobs
       WHERE tenant_id=$1 AND project_id=$2 AND kind='subject_export' AND artifact_ref IS NOT NULL
       LIMIT 1 FOR UPDATE`, [ scope.tenantId, scope.projectId ],
    )
    // A deletion must not report success while it leaves a previously-issued
    // private export readable from an unavailable store. A deployment can
    // restore the store and retry the durable project deletion job.
    if (existing.rows.length) throw new Error('subject_export_artifact_store_unavailable')
    return 0
  }
  const rows = await database.query<{ id: string; artifact_ref: string }>(
    `SELECT id, artifact_ref FROM data_subject_jobs
     WHERE tenant_id=$1 AND project_id=$2 AND kind='subject_export' AND artifact_ref IS NOT NULL
     ORDER BY id ASC FOR UPDATE`, [ scope.tenantId, scope.projectId ],
  )
  let removed = 0
  for (const row of rows.rows) {
    await artifacts.remove(row.artifact_ref)
    const result = await database.query(
      `UPDATE data_subject_jobs SET artifact_ref=NULL, byte_count=NULL,
         status=CASE WHEN status='completed' THEN 'cancelled' ELSE status END,
         reason_code=CASE WHEN status='completed' THEN 'project_deleted' ELSE reason_code END,
         finished_at=CASE WHEN status='completed' THEN COALESCE(finished_at, now()) ELSE finished_at END
       WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND artifact_ref=$4`,
      [ row.id, scope.tenantId, scope.projectId, row.artifact_ref ],
    )
    removed += result.rowCount ?? 0
  }
  return removed
}

export async function anonymizeSubjectFacts(database: DatabaseClient, tenantId: string, projectId: string, businessUserId: string): Promise<number> {
  // Do not delete visitor facts or replay objects here. The browser identity can
  // legitimately have more than one verified business-user relationship; only
  // the subject snapshot is removed. `identities` carries traits and
  // `business_user_profiles` carries directory fields; both are direct subject
  // records and are permanently deleted.
  const scope = [ tenantId, projectId, businessUserId ]
  const anonymized = await updateBusinessUserIdStatements(database, [
    { table: 'events', values: scope },
    { table: 'error_occurrences', values: scope },
    { table: 'behavior_events', values: scope },
    { table: 'performance_events', values: scope },
    { table: 'replay_sessions', values: scope },
  ])
  const identities = await deleteStatements(database, [
    { table: 'identity_assertions', where: 'tenant_id = $1 AND project_id = $2 AND business_user_id = $3', values: scope },
    { table: 'identities', where: 'tenant_id = $1 AND project_id = $2 AND business_user_id = $3', values: scope },
    { table: 'business_user_profiles', where: 'tenant_id = $1 AND project_id = $2 AND business_user_id = $3', values: scope },
  ])
  return anonymized + identities
}

type BusinessUserUpdate = { table: 'events' | 'error_occurrences' | 'behavior_events' | 'performance_events' | 'replay_sessions'; values: unknown[] }
async function updateBusinessUserIdStatements(database: DatabaseClient, statements: BusinessUserUpdate[]): Promise<number> {
  let changed = 0
  for (const statement of statements) {
    while (true) {
      const result = await database.query(
        `WITH candidates AS (
           SELECT ctid FROM ${statement.table}
           WHERE tenant_id = $1 AND project_id = $2 AND business_user_id = $3
           ORDER BY ctid LIMIT $4
         ) UPDATE ${statement.table} SET business_user_id = NULL
           WHERE ctid IN (SELECT ctid FROM candidates)`,
        [ ...statement.values, DELETE_BATCH_SIZE ],
      )
      const count = result.rowCount ?? 0
      changed += count
      if (count < DELETE_BATCH_SIZE) break
    }
  }
  return changed
}

export async function deleteProjectFacts(database: DatabaseClient, tenantId: string, projectId: string): Promise<number> {
  const scope = [ tenantId, projectId ]
  const tables = [
    // Children first: a restored database retains the same FK contract.
    'data_subject_export_download_tokens', 'analytics_export_download_tokens', 'dashboard_tiles', 'cohort_snapshots', 'report_runs', 'report_schedules',
    'notification_deliveries', 'alert_instances', 'alert_rule_targets', 'alert_rules', 'notification_targets',
    'analytics_export_jobs', 'saved_insights', 'dashboards', 'cohorts', 'performance_metric_daily', 'source_map_artifacts',
    'replay_sessions', 'error_state_history', 'error_occurrences', 'error_groups', 'events', 'behavior_events',
    'performance_events', 'performance_observations', 'identities', 'identity_assertions', 'business_user_profiles', 'mobile_ingest_declarations',
    'ingest_receipts', 'ingest_rate_limit_buckets', 'project_key_audit', 'project_key_rotation_requests',
  ]
  const statements: BatchDelete[] = tables.map(table => ({ table, where: 'tenant_id = $1 AND project_id = $2', values: scope }))
  statements[tables.indexOf('alert_rule_targets')] = {
    table: 'alert_rule_targets', where: 'rule_id IN (SELECT id FROM alert_rules WHERE tenant_id = $1 AND project_id = $2)', values: scope,
  }
  statements[0] = {
    table: 'data_subject_export_download_tokens', where: 'tenant_id = $1 AND project_id = $2', values: scope,
  }
  statements[1] = {
    table: 'analytics_export_download_tokens', where: 'export_job_id IN (SELECT id FROM analytics_export_jobs WHERE tenant_id = $1 AND project_id = $2)', values: scope,
  }
  return deleteStatements(database, statements)
}

type BatchDelete = { table: string; where: string; values: unknown[] }

async function deleteStatements(database: DatabaseClient, statements: BatchDelete[]): Promise<number> {
  let removed = 0
  for (const statement of statements) {
    while (true) {
      const result = await database.query(
        `WITH candidates AS (
           SELECT ctid FROM ${statement.table} WHERE ${statement.where} ORDER BY ctid LIMIT $${statement.values.length + 1}
         ) DELETE FROM ${statement.table} WHERE ctid IN (SELECT ctid FROM candidates)`,
        [ ...statement.values, DELETE_BATCH_SIZE ],
      )
      const count = result.rowCount ?? 0
      removed += count
      if (count < DELETE_BATCH_SIZE) break
    }
  }
  return removed
}

async function audit(database: DatabaseClient, tenantId: string, actorUserId: string, action: string, targetType: string, targetId: string, metadata: Record<string, unknown>): Promise<void> {
  await database.query(
    `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [ randomUUID(), tenantId, actorUserId, action, targetType, targetId, JSON.stringify(metadata) ],
  )
}

function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error(`invalid_lifecycle_payload:${field}`)
  return value
}

function terminal(status: string): boolean { return status === 'completed' || status === 'failed' || status === 'expired' || status === 'cancelled' }

/**
 * The export is deliberately a bounded JSON document. It contains only facts
 * directly attributed to the requested business-user id, never other users of
 * a shared browser visitor, authentication proofs, token hashes or storage
 * locations. Replay payloads remain excluded: the recorder itself deliberately
 * has no DOM or form-value data and its objects cannot be safely sliced by a
 * business-user relationship.
 */
async function renderSubjectExport(database: DatabaseClient, job: LeasedWorkerJob, request: SubjectRow): Promise<Buffer> {
  const scope = [ job.tenant_id, job.project_id, request.subject_business_user_id ]
  const [ profiles, identities, events, errors, behavior, performance, replaySessions ] = await Promise.all([
    database.query(`SELECT email_normalized, display_name, department, role, is_active, source_updated_at, created_at, updated_at FROM business_user_profiles WHERE tenant_id=$1 AND project_id=$2 AND business_user_id=$3`, scope),
    database.query(`SELECT visitor_id, traits, first_login_at, last_login_at FROM identities WHERE tenant_id=$1 AND project_id=$2 AND business_user_id=$3 ORDER BY visitor_id ASC`, scope),
    database.query(`SELECT client_event_id, client_instance_id, client_sequence, name, visitor_id, url, route, browser, device, release, properties, occurred_at, received_at FROM events WHERE tenant_id=$1 AND project_id=$2 AND business_user_id=$3 ORDER BY occurred_at ASC, id ASC LIMIT 100000`, scope),
    database.query(`SELECT id, group_id, client_event_id, occurred_at, received_at, visitor_id, release, dist, replay_session_id, url, route, browser, device, mechanism, stack, frames FROM error_occurrences WHERE tenant_id=$1 AND project_id=$2 AND business_user_id=$3 ORDER BY occurred_at ASC, id ASC LIMIT 100000`, scope),
    database.query(`SELECT client_event_id, visitor_id, page_key, page_version, action, element_key, occurred_at, received_at FROM behavior_events WHERE tenant_id=$1 AND project_id=$2 AND business_user_id=$3 ORDER BY occurred_at ASC, id ASC LIMIT 100000`, scope),
    database.query(`SELECT client_event_id, visitor_id, page_key, metric_name, metric_value, metric_id, occurred_at, received_at FROM performance_events WHERE tenant_id=$1 AND project_id=$2 AND business_user_id=$3 ORDER BY occurred_at ASC, id ASC LIMIT 100000`, scope),
    database.query(`SELECT id, visitor_id, started_at, release, policy_version, initial_route, sample_decision, received_at FROM replay_sessions WHERE tenant_id=$1 AND project_id=$2 AND business_user_id=$3 ORDER BY started_at ASC, id ASC LIMIT 100000`, scope),
  ])
  const contents = Buffer.from(JSON.stringify({
    schema_version: 1,
    generated_at: new Date().toISOString(),
    subject_business_user_id: request.subject_business_user_id,
    data: {
      business_user_profiles: profiles.rows,
      identities: identities.rows,
      events: events.rows,
      error_occurrences: errors.rows,
      behavior_events: behavior.rows,
      performance_events: performance.rows,
      replay_sessions: replaySessions.rows,
    },
    limits: { per_category: 100000, replay_payloads_included: false },
  }), 'utf8')
  if (contents.length > 50 * 1024 * 1024) throw new Error('export_limit_exceeded')
  return contents
}

function subjectExportErrorCode(error: unknown): string {
  return error instanceof Error && error.message === 'export_limit_exceeded' ? 'export_limit_exceeded' : 'export_execution_failed'
}
