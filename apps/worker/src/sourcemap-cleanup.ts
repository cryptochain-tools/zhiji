import { DatabaseClient } from '../../server/app/service/database/types'
import { cleanupExpiredSourceMaps } from '../../server/app/service/sourcemaps/cleanup'
import { PrivateSourceMapArtifactStore } from '../../server/app/service/sourcemaps/artifacts'
import { LeasedWorkerJob, WorkerHandlers } from '../../server/app/service/worker'

/** Executes one bounded, retry-safe private Source Map cleanup batch. */
export class SourceMapCleanupHandler implements Pick<WorkerHandlers, 'runJob'> {
  constructor(private readonly database: DatabaseClient, private readonly artifacts?: PrivateSourceMapArtifactStore, private readonly now: () => Date = () => new Date()) {}

  async runJob(job: LeasedWorkerJob): Promise<{ processedCount: number; failedCount: number; watermark?: Record<string, unknown> }> {
    if (job.kind !== 'sourcemap_cleanup') throw new Error(`unsupported_worker_job:${job.kind}`)
    const configuredDays = job.payload.error_occurrence_days
    const days = configuredDays === undefined ? undefined : positiveInteger(configuredDays)
    if (configuredDays !== undefined && days === null) throw new Error('invalid_sourcemap_cleanup_payload')
    const removed = await cleanupExpiredSourceMaps(this.database, this.artifacts, { tenantId: job.tenant_id, projectId: job.project_id, now: this.now(), errorOccurrenceDays: days ?? undefined })
    return { processedCount: removed, failedCount: 0, watermark: { deleted_source_map_artifacts: removed, error_occurrence_days: days ?? 90 } }
  }
}
function positiveInteger(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 3650 ? value : null }
