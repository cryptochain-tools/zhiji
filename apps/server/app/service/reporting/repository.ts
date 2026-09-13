import { randomUUID } from 'node:crypto'
import { DatabaseClient } from '../database/types'
import { PerformanceDetailQuery, PerformanceQuery, ReportingScope } from './contracts'

export interface PerformanceRow { metric_name: string; page_key: string | null; release: string | null; sample_count: number; p50: number | null; p75: number | null; p95: number | null; good_count: number; needs_improvement_count: number; poor_count: number }
export interface PerformanceDetailPoint extends Omit<PerformanceRow, 'metric_name' | 'page_key'> { bucket_start: Date; navigation_scope: 'hard' | 'soft' }
export interface PerformanceReleaseSummary extends Omit<PerformanceRow, 'metric_name' | 'page_key'> {}
export class ReportingRepository {
  constructor(private readonly database: DatabaseClient) {}
  async performance(scope: ReportingScope, query: PerformanceQuery): Promise<PerformanceRow[]> {
    const result = await this.database.query<PerformanceRow>(
      `SELECT metric_name, page_key, release, count(*)::integer AS sample_count,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY value) AS p50,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY value) AS p95,
              count(*) FILTER (WHERE rating = 'good')::integer AS good_count,
              count(*) FILTER (WHERE rating = 'needs_improvement')::integer AS needs_improvement_count,
              count(*) FILTER (WHERE rating = 'poor')::integer AS poor_count
       FROM performance_observations
       WHERE tenant_id = $1 AND project_id = $2 AND occurred_at >= $3 AND occurred_at < $4
         AND ($5::text IS NULL OR metric_name = $5) AND ($6::text IS NULL OR page_key = $6) AND ($7::text IS NULL OR release = $7)
       GROUP BY metric_name, page_key, release ORDER BY metric_name, page_key NULLS FIRST, release NULLS FIRST LIMIT 500`,
      [ scope.tenantId, scope.projectId, query.from, query.to, query.metric ?? null, query.pageKey ?? null, query.release ?? null ],
    )
    return result.rows
  }
  /**
   * Page details only aggregate observations that match one exact sanitized
   * page key and metric. There are no visitor, business user, route or UA
   * columns in this read model.
   */
  async performanceDetail(scope: ReportingScope, query: PerformanceDetailQuery): Promise<{ points: PerformanceDetailPoint[]; releases: PerformanceReleaseSummary[] }> {
    const values = [ scope.tenantId, scope.projectId, query.pageKey, query.metric, query.from, query.to ]
    const [points, releases] = await Promise.all([
      this.database.query<PerformanceDetailPoint>(
        `SELECT date_trunc('day', occurred_at) AS bucket_start, release,
                CASE WHEN navigation_type = 'soft_navigation' THEN 'soft' ELSE 'hard' END AS navigation_scope,
                count(*)::integer AS sample_count,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY value) AS p50,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY value) AS p95,
                count(*) FILTER (WHERE rating = 'good')::integer AS good_count,
                count(*) FILTER (WHERE rating = 'needs_improvement')::integer AS needs_improvement_count,
                count(*) FILTER (WHERE rating = 'poor')::integer AS poor_count
         FROM performance_observations
         WHERE tenant_id = $1 AND project_id = $2 AND page_key = $3 AND metric_name = $4
           AND occurred_at >= $5 AND occurred_at < $6
         GROUP BY bucket_start, release, navigation_scope
         ORDER BY bucket_start ASC, release NULLS FIRST, navigation_scope ASC
         LIMIT 10000`, values),
      this.database.query<PerformanceReleaseSummary>(
        `SELECT release, count(*)::integer AS sample_count,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY value) AS p50,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY value) AS p95,
                count(*) FILTER (WHERE rating = 'good')::integer AS good_count,
                count(*) FILTER (WHERE rating = 'needs_improvement')::integer AS needs_improvement_count,
                count(*) FILTER (WHERE rating = 'poor')::integer AS poor_count
         FROM performance_observations
         WHERE tenant_id = $1 AND project_id = $2 AND page_key = $3 AND metric_name = $4
           AND occurred_at >= $5 AND occurred_at < $6
         GROUP BY release ORDER BY release NULLS FIRST LIMIT 500`, values),
    ])
    return { points: points.rows, releases: releases.rows }
  }
  async enqueueExport(input: { scope: ReportingScope; actorId: string; idempotencyKey: string; format: string; definition: object; queryHash: Buffer }): Promise<{ id: string; inserted: boolean }> {
    const result = await this.database.query<{ id: string; inserted: boolean }>(
      `WITH inserted AS (
         INSERT INTO analytics_export_jobs (id, tenant_id, project_id, requested_by, idempotency_key, format, definition, query_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now() + interval '24 hours')
         ON CONFLICT (tenant_id, project_id, requested_by, idempotency_key) DO UPDATE SET id = analytics_export_jobs.id
         RETURNING id, (xmax = 0) AS inserted
       ), audit AS (
         INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,metadata)
         SELECT $9,$2,$4,'analytics_export_requested','analytics_export_job',id,jsonb_build_object('format',$6,'kind',$7::jsonb->>'kind')
         FROM inserted WHERE inserted.inserted
       ) SELECT id,inserted FROM inserted`,
      [ randomUUID(), input.scope.tenantId, input.scope.projectId, input.actorId, input.idempotencyKey, input.format, JSON.stringify(input.definition), input.queryHash, randomUUID() ],
    )
    const row = result.rows[0]; if (!row) throw new Error('export job did not return a row'); return row
  }
}

export interface AnalyticsExportJobRow {
  id: string; tenant_id: string; project_id: string; requested_by: string; format: 'csv' | 'xlsx'; definition: Record<string, unknown>; status: string
  row_count: number | null; byte_count: string | number | null; error_code: string | null; artifact_ref: string | null
  created_at: Date; started_at: Date | null; finished_at: Date | null; expires_at: Date
}
export interface ExportDownloadTokenRow { artifact_ref: string; format: 'csv' | 'xlsx' }

export class AnalyticsExportRepository {
  constructor(private readonly database: DatabaseClient) {}
  async get(scope: ReportingScope, id: string): Promise<AnalyticsExportJobRow | null> {
    const result = await this.database.query<AnalyticsExportJobRow>(`SELECT id,tenant_id,project_id,requested_by,format,definition,status,row_count,byte_count,error_code,artifact_ref,created_at,started_at,finished_at,expires_at FROM analytics_export_jobs WHERE tenant_id=$1 AND project_id=$2 AND id=$3`, [ scope.tenantId, scope.projectId, id ])
    return result.rows[0] ?? null
  }
  async cancel(scope: ReportingScope, id: string, actorId: string): Promise<boolean> {
    const result = await this.database.query(`WITH updated AS (UPDATE analytics_export_jobs SET status='cancelled',finished_at=now(),error_code='cancelled' WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND requested_by=$4 AND status='queued' RETURNING id), audit AS (INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,metadata) SELECT $5,$1,$4,'analytics_export_cancelled','analytics_export_job',id,'{}'::jsonb FROM updated) SELECT id FROM updated`, [ scope.tenantId, scope.projectId, id, actorId, randomUUID() ])
    return result.rowCount === 1
  }
  async issueDownloadToken(scope: ReportingScope, id: string, actorId: string, tokenHash: Buffer): Promise<boolean> {
    const result = await this.database.query(`WITH target AS (SELECT id FROM analytics_export_jobs WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND requested_by=$4 AND status='completed' AND artifact_ref IS NOT NULL AND expires_at>now()), invalidated AS (UPDATE analytics_export_download_tokens SET used_at=now() WHERE export_job_id=$3 AND requested_by=$4 AND used_at IS NULL), inserted AS (INSERT INTO analytics_export_download_tokens (id,tenant_id,project_id,export_job_id,requested_by,token_hash,expires_at) SELECT $5,$1,$2,id,$4,$6,LEAST(now()+interval '15 minutes',(SELECT expires_at FROM analytics_export_jobs WHERE id=$3)) FROM target RETURNING id) SELECT id FROM inserted`, [ scope.tenantId, scope.projectId, id, actorId, randomUUID(), tokenHash ])
    return result.rowCount === 1
  }
  async consumeDownloadToken(scope: ReportingScope, id: string, actorId: string, tokenHash: Buffer): Promise<ExportDownloadTokenRow | null> {
    const result = await this.database.query<ExportDownloadTokenRow>(`WITH consumed AS (UPDATE analytics_export_download_tokens t SET used_at=now() FROM analytics_export_jobs j WHERE t.export_job_id=j.id AND t.tenant_id=$1 AND t.project_id=$2 AND t.export_job_id=$3 AND t.requested_by=$4 AND t.token_hash=$5 AND t.used_at IS NULL AND t.expires_at>now() AND j.status='completed' AND j.expires_at>now() RETURNING j.artifact_ref,j.format) SELECT artifact_ref,format FROM consumed`, [ scope.tenantId, scope.projectId, id, actorId, tokenHash ])
    return result.rows[0] ?? null
  }
  async claim(scope: ReportingScope, id: string): Promise<AnalyticsExportJobRow | null> {
    await this.database.query(`UPDATE analytics_export_jobs SET status='expired',finished_at=now(),error_code='export_expired' WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND status='queued' AND expires_at<=now()`, [ scope.tenantId, scope.projectId, id ])
    const result = await this.database.query<AnalyticsExportJobRow>(`UPDATE analytics_export_jobs SET status='running',started_at=COALESCE(started_at,now()),error_code=NULL WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND status='queued' AND expires_at>now() RETURNING id,tenant_id,project_id,requested_by,format,definition,status,row_count,byte_count,error_code,artifact_ref,created_at,started_at,finished_at,expires_at`, [ scope.tenantId, scope.projectId, id ])
    return result.rows[0] ?? null
  }
  async complete(scope: ReportingScope, id: string, artifactRef: string, rowCount: number, byteCount: number): Promise<boolean> {
    const result = await this.database.query(`UPDATE analytics_export_jobs SET status='completed',artifact_ref=$4,row_count=$5,byte_count=$6,finished_at=now(),error_code=NULL WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND status='running' AND expires_at>now()`, [ scope.tenantId, scope.projectId, id, artifactRef, rowCount, byteCount ])
    return result.rowCount === 1
  }
  async fail(scope: ReportingScope, id: string, code: string): Promise<boolean> {
    const result = await this.database.query(`UPDATE analytics_export_jobs SET status=CASE WHEN expires_at<=now() THEN 'expired' ELSE 'failed' END,error_code=$4,finished_at=now() WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND status IN ('queued','running')`, [ scope.tenantId, scope.projectId, id, code ])
    return result.rowCount === 1
  }
}
