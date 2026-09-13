import { randomUUID } from 'node:crypto'
import { DatabaseClient } from '../database/types'
import { LifecycleJobRecord, ProjectDeletionRecord, ProjectDeletionStatus, SubjectJobKind } from './types'

export class LifecycleRepository {
  constructor(private readonly database: DatabaseClient) {}

  async activeProject(tenantId: string, projectId: string): Promise<boolean> {
    const result = await this.database.query<{ id: string }>(
      "SELECT id FROM projects WHERE tenant_id = $1 AND id = $2 AND deletion_status = 'active'",
      [ tenantId, projectId ],
    )
    return result.rowCount === 1
  }

  async enqueueSubjectJob(input: {
    tenantId: string; projectId: string; actorUserId: string; kind: SubjectJobKind
    businessUserId: string; verification: { method: string; reauthenticatedAt: Date }
    scopeHash: Buffer; idempotencyKey: string; expiresAt: Date
  }): Promise<{ job: LifecycleJobRecord; inserted: boolean }> {
    const result = await this.database.query<LifecycleJobRecord & { inserted: boolean }>(
      `INSERT INTO data_subject_jobs
         (id, tenant_id, project_id, kind, requested_by, subject_business_user_id, verification_method,
          reauthenticated_at, scope_hash, idempotency_key, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (tenant_id, project_id, requested_by, kind, idempotency_key)
       DO UPDATE SET id = data_subject_jobs.id
       RETURNING id, requested_by, kind, status, subject_business_user_id, verification_method, reauthenticated_at,
                 created_at, started_at, finished_at, expires_at, reason_code, artifact_ref, byte_count, (xmax = 0) AS inserted`,
      [ randomUUID(), input.tenantId, input.projectId, input.kind, input.actorUserId, input.businessUserId,
        input.verification.method, input.verification.reauthenticatedAt, input.scopeHash, input.idempotencyKey, input.expiresAt ],
    )
    const row = result.rows[0]
    if (!row) throw new Error('subject job enqueue did not return a row')
    const { inserted, ...job } = row
    return { job, inserted }
  }

  async subjectJob(tenantId: string, projectId: string, jobId: string): Promise<LifecycleJobRecord | null> {
    const result = await this.database.query<LifecycleJobRecord>(
      `SELECT id, requested_by, kind, status, subject_business_user_id, verification_method, reauthenticated_at,
              created_at, started_at, finished_at, expires_at, reason_code, artifact_ref, byte_count
       FROM data_subject_jobs WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
      [ tenantId, projectId, jobId ],
    )
    return result.rows[0] ?? null
  }

  async subjectJobByIdempotency(tenantId: string, projectId: string, actorUserId: string, kind: SubjectJobKind, idempotencyKey: string): Promise<LifecycleJobRecord | null> {
    const result = await this.database.query<LifecycleJobRecord>(
      `SELECT id, requested_by, kind, status, subject_business_user_id, verification_method, reauthenticated_at,
              created_at, started_at, finished_at, expires_at, reason_code, artifact_ref, byte_count
       FROM data_subject_jobs
       WHERE tenant_id = $1 AND project_id = $2 AND requested_by = $3 AND kind = $4 AND idempotency_key = $5`,
      [ tenantId, projectId, actorUserId, kind, idempotencyKey ],
    )
    return result.rows[0] ?? null
  }

  async subjectJobs(input: { tenantId: string; projectId: string; actorUserId: string; kind: SubjectJobKind; owner: boolean }): Promise<LifecycleJobRecord[]> {
    const result = await this.database.query<LifecycleJobRecord>(
      `SELECT id, requested_by, kind, status, subject_business_user_id, verification_method, reauthenticated_at,
              created_at, started_at, finished_at, expires_at, reason_code, artifact_ref, byte_count
       FROM data_subject_jobs WHERE tenant_id=$1 AND project_id=$2 AND kind=$3
         AND ($4::boolean OR requested_by=$5)
       ORDER BY created_at DESC, id DESC LIMIT 100`,
      [ input.tenantId, input.projectId, input.kind, input.owner, input.actorUserId ],
    )
    return result.rows
  }

  async requestProjectDeletion(input: {
    tenantId: string; projectId: string; actorUserId: string; verification: { method: string; reauthenticatedAt: Date }
    idempotencyKey: string; effectiveAt: Date
  }): Promise<{ request: ProjectDeletionRecord; inserted: boolean }> {
    const result = await this.database.query<ProjectDeletionRecord & { inserted: boolean }>(
      `WITH created AS (
         INSERT INTO project_deletion_requests
           (id, tenant_id, project_id, requested_by, verification_method, reauthenticated_at, idempotency_key, effective_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, project_id, requested_by, idempotency_key)
         DO UPDATE SET id = project_deletion_requests.id
         RETURNING id, status, effective_at, created_at, cancelled_at, (xmax = 0) AS inserted
       ), frozen AS (
         UPDATE projects SET deletion_status = 'pending', deletion_requested_at = now(), deletion_effective_at = $8,
             deletion_cancelled_at = NULL, updated_at = now()
         WHERE tenant_id = $2 AND id = $3 AND deletion_status = 'active'
         RETURNING id
       ), locks AS (
         INSERT INTO project_deletion_key_locks (deletion_request_id, key_id, disabled_at)
         SELECT created.id, keys.id, now() FROM project_keys AS keys CROSS JOIN created
         WHERE keys.tenant_id = $2 AND keys.project_id = $3 AND keys.disabled_at IS NULL
           AND EXISTS (SELECT 1 FROM frozen)
         RETURNING key_id, disabled_at
       ), disabled AS (
         UPDATE project_keys AS keys SET disabled_at = locks.disabled_at
         FROM locks WHERE locks.key_id = keys.id AND keys.disabled_at IS NULL
       ) SELECT * FROM created`,
      [ randomUUID(), input.tenantId, input.projectId, input.actorUserId, input.verification.method,
        input.verification.reauthenticatedAt, input.idempotencyKey, input.effectiveAt ],
    )
    const row = result.rows[0]
    if (!row) throw new Error('project deletion request did not return a row')
    const { inserted, ...request } = row
    return { request, inserted }
  }

  async projectDeletion(tenantId: string, projectId: string): Promise<(ProjectDeletionRecord & { project_status: ProjectDeletionStatus }) | null> {
    const result = await this.database.query<ProjectDeletionRecord & { project_status: ProjectDeletionStatus }>(
      `SELECT request.id, request.status, request.effective_at, request.created_at, request.cancelled_at,
              project.deletion_status AS project_status
       FROM project_deletion_requests AS request
       INNER JOIN projects AS project ON project.tenant_id = request.tenant_id AND project.id = request.project_id
       WHERE request.tenant_id = $1 AND request.project_id = $2
       ORDER BY request.created_at DESC, request.id DESC LIMIT 1`,
      [ tenantId, projectId ],
    )
    return result.rows[0] ?? null
  }

  async projectDeletionByIdempotency(tenantId: string, projectId: string, actorUserId: string, idempotencyKey: string): Promise<ProjectDeletionRecord | null> {
    const result = await this.database.query<ProjectDeletionRecord>(
      `SELECT id, status, effective_at, created_at, cancelled_at
       FROM project_deletion_requests
       WHERE tenant_id = $1 AND project_id = $2 AND requested_by = $3 AND idempotency_key = $4`,
      [ tenantId, projectId, actorUserId, idempotencyKey ],
    )
    return result.rows[0] ?? null
  }

  async cancelProjectDeletion(tenantId: string, projectId: string, actorUserId: string): Promise<ProjectDeletionRecord | null> {
    const result = await this.database.query<ProjectDeletionRecord>(
      `WITH cancelled AS (
         UPDATE project_deletion_requests SET status = 'cancelled', cancelled_at = now()
         WHERE tenant_id = $1 AND project_id = $2 AND requested_by = $3
           AND status = 'pending' AND effective_at > now()
         RETURNING id, status, effective_at, created_at, cancelled_at
       ), restored_keys AS (
         UPDATE project_keys AS keys SET disabled_at = NULL
         FROM project_deletion_key_locks AS locks
         WHERE locks.deletion_request_id IN (SELECT id FROM cancelled)
           AND locks.key_id = keys.id AND locks.restored_at IS NULL
           AND keys.disabled_at = locks.disabled_at
       ), restored_locks AS (
         UPDATE project_deletion_key_locks SET restored_at = now()
         WHERE deletion_request_id IN (SELECT id FROM cancelled) AND restored_at IS NULL
       ), restored AS (
         UPDATE projects SET deletion_status = 'active', deletion_requested_at = NULL, deletion_effective_at = NULL,
             deletion_cancelled_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND deletion_status = 'pending'
           AND EXISTS (SELECT 1 FROM cancelled)
       ) SELECT * FROM cancelled`,
      [ tenantId, projectId, actorUserId ],
    )
    return result.rows[0] ?? null
  }

  async recordAudit(input: { tenantId: string; actorUserId: string; action: string; targetType: string; targetId: string; requestId?: string; metadata: Record<string, unknown> }): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, target_type, target_id, request_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [ randomUUID(), input.tenantId, input.actorUserId, input.action, input.targetType, input.targetId,
        input.requestId ?? null, JSON.stringify(input.metadata) ],
    )
  }
}


export interface SubjectExportDownloadRow { artifact_ref: string }

export async function issueSubjectExportDownloadToken(database: DatabaseClient, input: { tenantId: string; projectId: string; jobId: string; actorUserId: string; tokenHash: Buffer }): Promise<boolean> {
  const result = await database.query(`WITH target AS (
      SELECT id FROM data_subject_jobs WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND requested_by=$4
        AND kind='subject_export' AND status='completed' AND artifact_ref IS NOT NULL AND expires_at>now()
    ), invalidated AS (
      UPDATE data_subject_export_download_tokens SET used_at=now()
      WHERE data_subject_job_id=$3 AND requested_by=$4 AND used_at IS NULL
    ), inserted AS (
      INSERT INTO data_subject_export_download_tokens (id,tenant_id,project_id,data_subject_job_id,requested_by,token_hash,expires_at)
      SELECT $5,$1,$2,id,$4,$6,LEAST(now()+interval '15 minutes',(SELECT expires_at FROM data_subject_jobs WHERE id=$3)) FROM target RETURNING id
    ) SELECT id FROM inserted`, [ input.tenantId, input.projectId, input.jobId, input.actorUserId, randomUUID(), input.tokenHash ])
  return result.rowCount === 1
}

export async function consumeSubjectExportDownloadToken(database: DatabaseClient, input: { tenantId: string; projectId: string; jobId: string; actorUserId: string; tokenHash: Buffer }): Promise<SubjectExportDownloadRow | null> {
  const result = await database.query<SubjectExportDownloadRow>(`WITH consumed AS (
      UPDATE data_subject_export_download_tokens token SET used_at=now()
      FROM data_subject_jobs job WHERE token.data_subject_job_id=job.id
        AND token.tenant_id=$1 AND token.project_id=$2 AND token.data_subject_job_id=$3 AND token.requested_by=$4
        AND token.token_hash=$5 AND token.used_at IS NULL AND token.expires_at>now()
        AND job.kind='subject_export' AND job.status='completed' AND job.expires_at>now()
      RETURNING job.artifact_ref
    ) SELECT artifact_ref FROM consumed`, [ input.tenantId, input.projectId, input.jobId, input.actorUserId, input.tokenHash ])
  return result.rows[0] ?? null
}
