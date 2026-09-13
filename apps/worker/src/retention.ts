import { DatabaseClient, PostgreSqlConnection } from '../../server/app/service/database/types'
import { LeasedWorkerJob, WorkerHandlers } from '../../server/app/service/worker'
import { PrivateReplayArtifactStore } from '../../server/app/service/replay/artifacts'
import { DataLifecyclePolicy, legacyDataLifecyclePolicy, parseDataLifecyclePolicy } from '../../server/app/service/lifecycle/policy'

type TransactionDriver = DatabaseClient & { connect(): Promise<PostgreSqlConnection> }
type RetentionPolicyRow = { retention_days: number; data_lifecycle_policy?: unknown }

const BATCH_SIZE = 1_000
const DAY = 24 * 60 * 60 * 1_000

/**
 * Removes only raw, project-scoped ingest data.  The policy is resolved under
 * a project share lock so a project deletion cannot switch state while a batch
 * is running.  Each relation gets one primary-key ordered batch per job; a
 * periodic enqueue can safely resume it without retaining a cursor containing
 * customer data.
 */
export class RetentionCleanupHandler implements Pick<WorkerHandlers, 'runJob'> {
  constructor(private readonly database: TransactionDriver, private readonly now: () => Date = () => new Date(), private readonly replayArtifacts?: PrivateReplayArtifactStore) {}

  async runJob(job: LeasedWorkerJob): Promise<{ processedCount: number; failedCount: number; watermark?: Record<string, unknown> }> {
    if (job.kind !== 'retention_cleanup') throw new Error(`unsupported_worker_job:${job.kind}`)
    return this.transaction(async transaction => {
      const policy = await this.activePolicy(transaction, job)
      if (!policy) return {
        processedCount: 0,
        failedCount: 0,
        watermark: { skipped: 'project_not_active', preserved_metadata: preservedMetadata },
      }

      const now = this.now()
      // One PostgreSQL connection serializes these batches.  Keeping the order
      // explicit also makes replay chunk removal observably precede sessions.
      const events = await deleteIdBatch(transaction, 'events', job, cutoff(now, policy.raw_event_days), 'occurred_at')
      const errorOccurrences = await deleteIdBatch(transaction, 'error_occurrences', job, cutoff(now, policy.error_occurrence_days), 'occurred_at')
      const behaviorEvents = await deleteIdBatch(transaction, 'behavior_events', job, cutoff(now, policy.behavior_raw_days), 'occurred_at')
      const performanceEvents = await deleteIdBatch(transaction, 'performance_events', job, cutoff(now, policy.performance_raw_days), 'occurred_at')
      const performanceObservations = await deleteIdBatch(transaction, 'performance_observations', job, cutoff(now, policy.performance_raw_days), 'occurred_at')
      // Daily rollups are separately retained. They contain no raw event
      // payload, but must not outlive the configured aggregate horizon.
      const heatmapBins = await deleteDateBatch(transaction, 'heatmap_bins_daily', 'occurred_on', job, cutoff(now, policy.aggregate_days))
      const heatmapSeries = await deleteDateBatch(transaction, 'heatmap_series_daily', 'occurred_on', job, cutoff(now, policy.aggregate_days))
      const performanceDaily = await deleteDateBatch(transaction, 'performance_metric_daily', 'day', job, cutoff(now, policy.aggregate_days))
      const usageDaily = await deleteDateBatch(transaction, 'usage_ledger_daily', 'usage_date', job, cutoff(now, policy.aggregate_days))
      const replayChunks = await removeExpiredReplayArtifacts(transaction, this.replayArtifacts, job, cutoff(now, 7))
      const receipts = await deleteReceiptBatch(transaction, job, cutoff(now, 8))
      // Cohort snapshots deliberately contain only bounded aggregate metadata.
      // Remove expired rows in the ordinary per-project retention pass.
      const cohortSnapshots = await deleteExpiredCohortSnapshotBatch(transaction, job)
      // A replay session is metadata for its chunks. Delete it only after no
      // chunk remains, which keeps metadata when a future object-store adapter
      // requires a failed object delete to be retried.
      const sessions = await deleteEmptyReplaySessionBatch(transaction, job, cutoff(now, 7))
      const counts = { events, error_occurrences: errorOccurrences, behavior_events: behaviorEvents, performance_events: performanceEvents, performance_observations: performanceObservations, heatmap_bins_daily: heatmapBins, heatmap_series_daily: heatmapSeries, performance_metric_daily: performanceDaily, usage_ledger_daily: usageDaily, replay_chunks: replayChunks, ingest_receipts: receipts, cohort_snapshots: cohortSnapshots, replay_sessions: sessions }
      const processedCount = Object.values(counts).reduce((total, count) => total + count, 0)
      return {
        processedCount,
        failedCount: 0,
        watermark: {
          cutoff_at: now.toISOString(),
          effective_data_lifecycle: policy,
          deleted: counts,
          has_more: Object.values(counts).some(count => count === BATCH_SIZE),
          preserved_metadata: preservedMetadata,
        },
      }
    })
  }

  private async activePolicy(database: DatabaseClient, job: LeasedWorkerJob): Promise<DataLifecyclePolicy | null> {
    const result = await database.query<RetentionPolicyRow>(
      `SELECT COALESCE(projects.data_lifecycle_policy, tenants.data_lifecycle_policy) AS data_lifecycle_policy,
              COALESCE(projects.retention_days, tenants.retention_days) AS retention_days
       FROM projects JOIN tenants ON tenants.id = projects.tenant_id
       WHERE projects.tenant_id = $1 AND projects.id = $2 AND projects.deletion_status = 'active'
       FOR SHARE`,
      [ job.tenant_id, job.project_id ],
    )
    const row = result.rows[0]
    if (!row) return null
    const configured = parseDataLifecyclePolicy(row.data_lifecycle_policy)
    if (row.data_lifecycle_policy !== undefined && row.data_lifecycle_policy !== null && !configured) throw new Error('invalid_project_data_lifecycle_policy')
    return configured ?? legacyDataLifecyclePolicy(row.retention_days)
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

const preservedMetadata = [ 'error_groups', 'audit_logs', 'source_map_artifacts', 'heatmap_screenshots' ] as const

function cutoff(now: Date, days: number): Date { return new Date(now.getTime() - days * DAY) }

async function deleteIdBatch(database: DatabaseClient, table: 'events' | 'error_occurrences' | 'behavior_events' | 'performance_events' | 'performance_observations', job: LeasedWorkerJob, before: Date, timestampColumn: 'occurred_at'): Promise<number> {
  const result = await database.query(
    `WITH candidates AS (
       SELECT id FROM ${table}
       WHERE tenant_id = $1 AND project_id = $2 AND ${timestampColumn} < $3
       ORDER BY ${timestampColumn} ASC, id ASC
       LIMIT $4
     ) DELETE FROM ${table} AS facts USING candidates
       WHERE facts.id = candidates.id
         AND facts.tenant_id = $1 AND facts.project_id = $2`,
    [ job.tenant_id, job.project_id, before, BATCH_SIZE ],
  )
  return result.rowCount ?? 0
}

async function deleteDateBatch(database: DatabaseClient, table: 'heatmap_bins_daily' | 'heatmap_series_daily' | 'performance_metric_daily' | 'usage_ledger_daily', dateColumn: 'occurred_on' | 'day' | 'usage_date', job: LeasedWorkerJob, before: Date): Promise<number> {
  const result = await database.query(
    `WITH candidates AS (
       SELECT ctid FROM ${table}
       WHERE tenant_id = $1 AND project_id = $2 AND ${dateColumn} < ($3::timestamptz AT TIME ZONE 'UTC')::date
       ORDER BY ${dateColumn} ASC, ctid ASC LIMIT $4
     ) DELETE FROM ${table} AS aggregate USING candidates
       WHERE aggregate.ctid = candidates.ctid`,
    [ job.tenant_id, job.project_id, before, BATCH_SIZE ],
  )
  return result.rowCount ?? 0
}

async function removeExpiredReplayArtifacts(database: DatabaseClient, artifacts: PrivateReplayArtifactStore | undefined, job: LeasedWorkerJob, before: Date): Promise<number> {
  if (!artifacts) return 0
  // The worker first selects only expired metadata. Each individual object is
  // removed before its metadata row by `removeReplayArtifacts`.
  const candidates = await database.query<{ id: string; artifact_ref: string }>(
    'SELECT id, artifact_ref FROM replay_chunks WHERE tenant_id = $1 AND project_id = $2 AND occurred_to < $3 ORDER BY occurred_to ASC, id ASC LIMIT $4',
    [ job.tenant_id, job.project_id, before, BATCH_SIZE ],
  )
  let removed = 0
  for (const candidate of candidates.rows) {
    if (!artifacts) break
    await artifacts.remove(candidate.artifact_ref)
    const result = await database.query('DELETE FROM replay_chunks WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND artifact_ref = $4', [ candidate.id, job.tenant_id, job.project_id, candidate.artifact_ref ])
    removed += result.rowCount ?? 0
  }
  return removed
}

async function deleteReceiptBatch(database: DatabaseClient, job: LeasedWorkerJob, before: Date): Promise<number> {
  const result = await database.query(
    `WITH candidates AS (
       SELECT lane, client_event_id FROM ingest_receipts
       WHERE tenant_id = $1 AND project_id = $2 AND received_at < $3
       ORDER BY received_at ASC, lane ASC, client_event_id ASC
       LIMIT $4
     ) DELETE FROM ingest_receipts AS receipts USING candidates
       WHERE receipts.tenant_id = $1 AND receipts.project_id = $2
         AND receipts.lane = candidates.lane AND receipts.client_event_id = candidates.client_event_id`,
    [ job.tenant_id, job.project_id, before, BATCH_SIZE ],
  )
  return result.rowCount ?? 0
}

async function deleteEmptyReplaySessionBatch(database: DatabaseClient, job: LeasedWorkerJob, before: Date): Promise<number> {
  const result = await database.query(
    `WITH candidates AS (
       SELECT sessions.id FROM replay_sessions AS sessions
       WHERE sessions.tenant_id = $1 AND sessions.project_id = $2 AND sessions.started_at < $3
         AND NOT EXISTS (
           SELECT 1 FROM replay_chunks AS chunks
           WHERE chunks.tenant_id = sessions.tenant_id AND chunks.project_id = sessions.project_id AND chunks.session_id = sessions.id
         )
       ORDER BY sessions.started_at ASC, sessions.id ASC
       LIMIT $4
     ) DELETE FROM replay_sessions AS sessions USING candidates
       WHERE sessions.id = candidates.id
         AND sessions.tenant_id = $1 AND sessions.project_id = $2`,
    [ job.tenant_id, job.project_id, before, BATCH_SIZE ],
  )
  return result.rowCount ?? 0
}

async function deleteExpiredCohortSnapshotBatch(database: DatabaseClient, job: LeasedWorkerJob): Promise<number> {
  const result = await database.query(
    `WITH candidates AS (
       SELECT id FROM cohort_snapshots
       WHERE tenant_id = $1 AND project_id = $2 AND expires_at <= now()
       ORDER BY expires_at ASC, id ASC LIMIT $3
     ) DELETE FROM cohort_snapshots snapshots USING candidates
       WHERE snapshots.id = candidates.id AND snapshots.tenant_id = $1 AND snapshots.project_id = $2`,
    [ job.tenant_id, job.project_id, BATCH_SIZE ],
  )
  return result.rowCount ?? 0
}
