import { AnalyticsExportRepository } from '../../server/app/service/reporting/repository'
import { PrivateExportArtifactStore } from '../../server/app/service/reporting/artifacts'
import { renderAggregateExport } from '../../server/app/service/reporting/exporter'
import { parseDefinition } from '../../server/app/service/insights/contracts'
import type { DashboardExportPlan } from '../../server/app/service/reporting'
import { DatabaseClient } from '../../server/app/service/database/types'
import { LeasedWorkerJob, WorkerHandlers } from '../../server/app/service/worker'

/** Executes a frozen aggregate job; no temporary/public artifact is ever produced. */
export class AnalyticsExportJobHandler implements Pick<WorkerHandlers, 'runJob'> {
  constructor(private readonly database: DatabaseClient, private readonly artifacts?: PrivateExportArtifactStore) {}
  async runJob(job: LeasedWorkerJob): Promise<{ processedCount: number; failedCount: number; watermark?: Record<string, unknown> }> {
    if (job.kind !== 'report_export') throw new Error(`unsupported_worker_job:${job.kind}`)
    const id = exportJobId(job.payload.export_job_id)
    const scope = { tenantId: job.tenant_id, projectId: job.project_id }
    const repository = new AnalyticsExportRepository(this.database)
    if (!this.artifacts) { await repository.fail(scope, id, 'artifact_store_unavailable'); return { processedCount: 0, failedCount: 1, watermark: { terminal_reason: 'artifact_store_unavailable' } } }
    const claimed = await repository.claim(scope, id)
    if (!claimed) return { processedCount: 0, failedCount: 0, watermark: { skipped: 'not_queued_or_expired' } }
    try {
      const definition = exportDefinition(claimed.definition)
      const rendered = await renderAggregateExport(this.database, scope, definition, claimed.format)
      const artifact = await this.artifacts.put({ tenantId: scope.tenantId, projectId: scope.projectId, jobId: id, format: claimed.format, contents: rendered.contents })
      if (!await repository.complete(scope, id, artifact.ref, rendered.rowCount, artifact.byteCount)) { await this.artifacts.remove(artifact.ref); return { processedCount: 0, failedCount: 0, watermark: { skipped: 'state_changed' } } }
      return { processedCount: rendered.rowCount, failedCount: 0, watermark: { export_job_id: id, byte_count: artifact.byteCount } }
    } catch (error) {
      const code = safeCode(error)
      await repository.fail(scope, id, code)
      // Definition and limit failures are terminal. Infrastructure failures are
      // also recorded terminally until an explicit artifact retry policy exists.
      return { processedCount: 0, failedCount: 1, watermark: { export_job_id: id, terminal_reason: code } }
    }
  }
}
function exportJobId(value: unknown): string { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('invalid_export_job_payload') ; return value }
function safeCode(error: unknown): string { const message = error instanceof Error ? error.message : ''; return [ 'export_limit_exceeded', 'invalid_export_definition' ].includes(message) ? message : 'export_execution_failed' }

function exportDefinition(value: Record<string, unknown>) { if (value.export_plan === 'dashboard') { if (typeof value.name !== 'string' || !Array.isArray(value.definitions) || value.definitions.length < 1 || value.definitions.length > 24) throw new Error('invalid_export_definition'); return { export_plan: 'dashboard' as const, name: value.name, definitions: value.definitions.map(item => { if (!item || typeof item !== 'object' || Array.isArray(item) || typeof (item as Record<string, unknown>).name !== 'string') throw new Error('invalid_export_definition'); return { name: (item as Record<string, unknown>).name as string, definition: parseDefinition((item as Record<string, unknown>).definition) } }) } as DashboardExportPlan } return parseDefinition(value) }
