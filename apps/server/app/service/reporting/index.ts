import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { DatabaseClient } from '../database/types'
import { WorkerRepository } from '../worker/repository'
import { parseExportRequest, parsePerformanceDetailQuery, parsePerformanceQuery, ReportingScope } from './contracts'
import { InsightsRepository } from '../insights/repository'
import { InsightDefinition } from '../insights/contracts'
import { AnalyticsExportRepository, ReportingRepository } from './repository'
import { PrivateExportArtifactStore } from './artifacts'
import { isUuid } from '../tenancy'

export class ReportingManagementService {
  constructor(private readonly database: DatabaseClient, private readonly artifactStore?: PrivateExportArtifactStore) {}
  async performance(scope: ReportingScope, raw: unknown) {
    const query = parsePerformanceQuery(raw)
    const rows = await new ReportingRepository(this.database).performance(scope, query)
    return { from: query.from.toISOString(), to: query.to.toISOString(), items: rows.map(row => ({ ...row, sample_count: Number(row.sample_count), good_count: Number(row.good_count), needs_improvement_count: Number(row.needs_improvement_count), poor_count: Number(row.poor_count) })) }
  }
  async performanceDetail(scope: ReportingScope, raw: unknown, pageKey: unknown) {
    const query = parsePerformanceDetailQuery(raw, pageKey)
    const result = await new ReportingRepository(this.database).performanceDetail(scope, query)
    const metric = (row: { sample_count: number; good_count: number; needs_improvement_count: number; poor_count: number }) => ({ ...row, sample_count: Number(row.sample_count), good_count: Number(row.good_count), needs_improvement_count: Number(row.needs_improvement_count), poor_count: Number(row.poor_count) })
    return {
      from: query.from.toISOString(), to: query.to.toISOString(), page_key: query.pageKey, metric: query.metric,
      points: result.points.map(row => ({ ...metric(row), bucket_start: row.bucket_start.toISOString() })),
      page_versions: result.releases.map(metric),
    }
  }
  async requestExport(scope: ReportingScope, actorId: string, idempotencyKey: string, raw: unknown) {
    if (idempotencyKey.length < 1 || idempotencyKey.length > 200) throw httpError(400, 'invalid_idempotency_key', 'Idempotency-Key is required')
    if (!this.artifactStore) throw httpError(503, 'export_artifact_store_unavailable', 'Analytics export storage is unavailable')
    const input = parseExportRequest(raw)
    const exports = new ReportingRepository(this.database)
    const definition = await this.resolveExportDefinition(scope, actorId, input)
    const job = await exports.enqueueExport({ scope, actorId, idempotencyKey, format: input.format, definition, queryHash: createHash('sha256').update(JSON.stringify(definition)).digest() })
    // This is only durable scheduling. Worker handlers and artifact storage remain disabled until explicitly configured.
    if (job.inserted) await new WorkerRepository(this.database).enqueueJob({ id: randomUUID(), tenantId: scope.tenantId, projectId: scope.projectId, kind: 'report_export', idempotencyKey: `analytics-export:${job.id}`, payload: { export_job_id: job.id } })
    return { job_id: job.id, status: 'queued' as const }
  }
  private async resolveExportDefinition(scope: ReportingScope, actorId: string, input: ReturnType<typeof parseExportRequest>): Promise<InsightDefinition | DashboardExportPlan> {
    if (input.definition) return input.definition
    const target = input.target!; const repository = new InsightsRepository(this.database)
    if (target.type === 'insight') {
      const insight = await repository.getInsight(scope, target.id)
      if (!insight || (insight.visibility === 'private' && insight.created_by !== actorId)) throw httpError(404, 'resource_not_found', 'Export target was not found')
      return insight.definition
    }
    const dashboard = await repository.getDashboard(scope, target.id)
    if (!dashboard) throw httpError(404, 'resource_not_found', 'Export target was not found')
    const tiles = await repository.tiles(scope, target.id)
    if (tiles.length === 0 || tiles.some(tile => !tile.insight_definition)) throw httpError(404, 'resource_not_found', 'Export target was not found')
    return { export_plan: 'dashboard', name: dashboard.name, definitions: tiles.map(tile => ({ name: tile.title_override ?? tile.insight_name ?? 'analysis', definition: tile.insight_definition! })) }
  }
  async showExport(scope: ReportingScope, actorId: string, id: unknown) {
    const job = await new AnalyticsExportRepository(this.database).get(scope, exportId(id))
    if (!job || job.requested_by !== actorId) throw httpError(404, 'resource_not_found', 'Analytics export was not found')
    return exportDto(job)
  }
  async cancelExport(scope: ReportingScope, actorId: string, id: unknown) {
    const cancelled = await new AnalyticsExportRepository(this.database).cancel(scope, exportId(id), actorId)
    if (!cancelled) throw httpError(409, 'export_state_conflict', 'Analytics export cannot be cancelled')
    return { status: 'cancelled' as const }
  }
  async downloadExport(scope: ReportingScope, actorId: string, id: unknown, rawToken: unknown) {
    if (!this.artifactStore) throw httpError(503, 'export_artifact_store_unavailable', 'Analytics export storage is unavailable')
    const jobId = exportId(id); const repository = new AnalyticsExportRepository(this.database)
    if (rawToken === undefined) {
      const token = randomBytes(32).toString('base64url')
      if (!await repository.issueDownloadToken(scope, jobId, actorId, tokenHash(token))) throw httpError(404, 'resource_not_found', 'Analytics export was not found')
      return { token, expires_in_seconds: 900 }
    }
    if (typeof rawToken !== 'string' || rawToken.length < 32 || rawToken.length > 200) throw httpError(404, 'resource_not_found', 'Analytics export was not found')
    const target = await repository.consumeDownloadToken(scope, jobId, actorId, tokenHash(rawToken))
    if (!target?.artifact_ref) throw httpError(404, 'resource_not_found', 'Analytics export was not found')
    const contents = await this.artifactStore.read(target.artifact_ref)
    if (!contents) throw httpError(404, 'resource_not_found', 'Analytics export was not found')
    return { contents, format: target.format }
  }
}

export default class ReportingService extends Service {
  private domain(): ReportingManagementService { const database = this.config.zhiji.database; if (!database?.configured) throw httpError(503, 'reporting_unavailable', 'Reporting is unavailable'); return new ReportingManagementService(database, this.config.zhiji.analyticsExportArtifactStore) }
  performance(scope: ReportingScope, raw: unknown) { return this.domain().performance(scope, raw) }
  performanceDetail(scope: ReportingScope, raw: unknown, pageKey: unknown) { return this.domain().performanceDetail(scope, raw, pageKey) }
  requestExport(scope: ReportingScope, actorId: string, idempotencyKey: string, raw: unknown) { return this.domain().requestExport(scope, actorId, idempotencyKey, raw) }
  showExport(scope: ReportingScope, actorId: string, id: unknown) { return this.domain().showExport(scope, actorId, id) }
  cancelExport(scope: ReportingScope, actorId: string, id: unknown) { return this.domain().cancelExport(scope, actorId, id) }
  downloadExport(scope: ReportingScope, actorId: string, id: unknown, token: unknown) { return this.domain().downloadExport(scope, actorId, id, token) }
}

function exportId(value: unknown): string { if (!isUuid(value)) throw httpError(404, 'resource_not_found', 'Analytics export was not found'); return value }
function tokenHash(value: string): Buffer { return createHash('sha256').update(value).digest() }
function exportDto(job: import('./repository').AnalyticsExportJobRow) { return { id: job.id, status: job.status, format: job.format, row_count: job.row_count, byte_count: job.byte_count === null ? null : Number(job.byte_count), error_code: job.error_code, created_at: job.created_at.toISOString(), started_at: job.started_at?.toISOString() ?? null, finished_at: job.finished_at?.toISOString() ?? null, expires_at: job.expires_at.toISOString() } }

export interface DashboardExportPlan { export_plan: 'dashboard'; name: string; definitions: Array<{ name: string; definition: InsightDefinition }> }
