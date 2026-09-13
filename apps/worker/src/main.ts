import { Pool } from 'pg'
import { WorkerRepository, WorkerRuntime } from '../../server/app/service/worker'
import { DatabaseClient } from '../../server/app/service/database/types'
import { LifecycleJobHandlers } from './lifecycle'
import { RetentionCleanupHandler } from './retention'
import { AlertEvaluationHandler } from './alerts'
import { AnalyticsExportJobHandler } from './analytics-exports'
import { LocalPrivateExportArtifactStore, S3PrivateExportArtifactStore } from '../../server/app/service/reporting/artifacts'
import { LocalPrivateReplayArtifactStore, S3PrivateReplayArtifactStore } from '../../server/app/service/replay/artifacts'
import { LocalPrivateSourceMapArtifactStore, S3PrivateSourceMapArtifactStore } from '../../server/app/service/sourcemaps/artifacts'
import { s3ArtifactObjectStoreFromEnvironment } from '../../server/app/service/artifacts/s3'
import { SourceMapCleanupHandler } from './sourcemap-cleanup'
import { ReportScheduleRunHandler, ReportScheduleScanner } from './report-schedules'
import { RetentionScheduleScanner } from './retention-scheduler'
import { NotificationDeliveryHandler, configuredTargetsFromEnvironment, createTransportFromEnvironment, invitationKeyFromEnvironment } from './notification-delivery'

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('worker environment integer values must be positive integers')
  return parsed
}

/** Explicit entrypoint; importing this module alone never starts the worker. */
export async function startWorkerFromEnvironment(environment: NodeJS.ProcessEnv): Promise<{ stop(): Promise<void> }> {
  const connectionString = environment.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required to start worker')
  const pool = new Pool({ connectionString, max: readPositiveInteger(environment.WORKER_DATABASE_POOL_MAX, 5) })
  const database: DatabaseClient = pool as unknown as DatabaseClient
  const repository = new WorkerRepository(database)
  const workerDatabase = pool as unknown as DatabaseClient & { connect(): Promise<import('../../server/app/service/database/types').PostgreSqlConnection> }
  const s3Artifacts = s3ArtifactObjectStoreFromEnvironment(environment)
  const replayArtifactDirectory = environment.REPLAY_ARTIFACT_DIR
  const replayArtifacts = s3Artifacts ? new S3PrivateReplayArtifactStore(s3Artifacts) : replayArtifactDirectory ? new LocalPrivateReplayArtifactStore(replayArtifactDirectory) : undefined
  const sourceMapArtifactDirectory = environment.SOURCEMAP_ARTIFACT_DIR
  const sourceMapArtifacts = s3Artifacts ? new S3PrivateSourceMapArtifactStore(s3Artifacts) : sourceMapArtifactDirectory ? new LocalPrivateSourceMapArtifactStore(sourceMapArtifactDirectory) : undefined
  const sourceMapCleanup = new SourceMapCleanupHandler(database, sourceMapArtifacts)
  const artifactDirectory = environment.ANALYTICS_EXPORT_ARTIFACT_DIR
  const exportArtifacts = s3Artifacts ? new S3PrivateExportArtifactStore(s3Artifacts) : artifactDirectory ? new LocalPrivateExportArtifactStore(artifactDirectory) : undefined
  const lifecycle = new LifecycleJobHandlers(workerDatabase, replayArtifacts, exportArtifacts)
  const retention = new RetentionCleanupHandler(workerDatabase, undefined, replayArtifacts)
  const alerts = new AlertEvaluationHandler(workerDatabase)
  const exportJobs = new AnalyticsExportJobHandler(database, exportArtifacts)
  const reportScheduleScanner = new ReportScheduleScanner(workerDatabase)
  const retentionScheduleScanner = new RetentionScheduleScanner(database)
  const reportScheduleRuns = new ReportScheduleRunHandler(database, exportArtifacts)
  const targets = configuredTargetsFromEnvironment(environment.NOTIFICATION_DELIVERY_TARGETS)
  const publicBaseUrl = environment.PUBLIC_APP_URL ? new URL(environment.PUBLIC_APP_URL) : null
  if (publicBaseUrl && publicBaseUrl.protocol !== 'https:') throw new Error('PUBLIC_APP_URL must use https')
  const delivery = new NotificationDeliveryHandler(database, targets, createTransportFromEnvironment(environment), invitationKeyFromEnvironment(environment.INVITATION_OUTBOX_ENCRYPTION_KEY), publicBaseUrl, (environment.OUTBOUND_HTTPS_ALLOWLIST ?? '').split(',').map(value => value.trim()).filter(Boolean))
  const runtime = new WorkerRuntime(repository, {
    deliverOutbox(message) { return delivery.deliver(message) },
    runJob(job) {
      if (job.kind === 'retention_cleanup') return retention.runJob(job)
      if (job.kind === 'alert_evaluation') return alerts.runJob(job)
      if (job.kind === 'report_export') return exportJobs.runJob(job)
      if (job.kind === 'sourcemap_cleanup') return sourceMapCleanup.runJob(job)
      if (job.kind === 'report_schedule_run') return reportScheduleRuns.runJob(job)
      return lifecycle.runJob(job)
    },
  }, {
    workerId: environment.WORKER_ID,
    pollIntervalMilliseconds: readPositiveInteger(environment.WORKER_POLL_INTERVAL_MS, 1_000),
    leaseSeconds: readPositiveInteger(environment.WORKER_LEASE_SECONDS, 30),
  })
  runtime.start()
  const scanIntervalMilliseconds = readPositiveInteger(environment.REPORT_SCHEDULE_SCAN_INTERVAL_MS, 60_000)
  const scanReportSchedules = () => { void reportScheduleScanner.scan().catch(error => process.stderr.write(`report schedule scan failed: ${error instanceof Error ? error.message : 'unknown'}\n`)) }
  scanReportSchedules()
  const reportScheduleTimer = setInterval(scanReportSchedules, scanIntervalMilliseconds)
  const retentionScanIntervalMilliseconds = readPositiveInteger(environment.RETENTION_SCAN_INTERVAL_MS, 6 * 60 * 60 * 1_000)
  const scanRetention = () => { void retentionScheduleScanner.scan().catch(error => process.stderr.write(`retention scan failed: ${error instanceof Error ? error.message : 'unknown'}\n`)) }
  scanRetention()
  const retentionTimer = setInterval(scanRetention, retentionScanIntervalMilliseconds)
  return {
    async stop() {
      clearInterval(reportScheduleTimer)
      clearInterval(retentionTimer)
      await runtime.stop()
      await pool.end()
    },
  }
}

async function main(): Promise<void> {
  const worker = await startWorkerFromEnvironment(process.env)
  const stop = async () => { await worker.stop() }
  process.once('SIGTERM', () => { void stop() })
  process.once('SIGINT', () => { void stop() })
}

if (require.main === module) void main()
