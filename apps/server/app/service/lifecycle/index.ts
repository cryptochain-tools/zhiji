import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { DatabaseClient } from '../database/types'
import { WorkerRepository } from '../worker/repository'
import { LifecycleRepository, consumeSubjectExportDownloadToken, issueSubjectExportDownloadToken } from './repository'
import { PrivateExportArtifactStore } from '../reporting/artifacts'
import { LifecycleJobRecord, LifecycleProofIssuer, LifecycleRequestVerifier, LifecycleScope, ProjectDeletionRecord, SubjectJobKind } from './types'

const SUBJECT_JOB_TTL_MS = 24 * 60 * 60 * 1000
const PROJECT_CANCELLATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const REAUTH_MAX_AGE_MS = 10 * 60 * 1000

export class LifecycleManagementService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly verifier: LifecycleRequestVerifier,
    private readonly now: () => Date = () => new Date(),
    private readonly artifactStore?: PrivateExportArtifactStore,
  ) {}

  async requestSubjectExport(scope: LifecycleScope, idempotencyKey: unknown, raw: unknown, requestId?: string) {
    if (!this.artifactStore) throw httpError(503, 'subject_export_artifact_store_unavailable', 'Data subject export storage is unavailable')
    return this.requestSubjectJob(scope, 'subject_export', idempotencyKey, raw, requestId)
  }

  async requestSubjectDeletion(scope: LifecycleScope, idempotencyKey: unknown, raw: unknown, requestId?: string) {
    return this.requestSubjectJob(scope, 'subject_deletion', idempotencyKey, raw, requestId)
  }

  async subjectJob(scope: LifecycleScope, jobId: unknown) {
    const id = uuid(jobId, 'subject_job_not_found')
    const job = await new LifecycleRepository(this.database).subjectJob(scope.tenantId, scope.projectId, id)
    if (!job) throw httpError(404, 'subject_job_not_found', 'Data subject request was not found')
    if (scope.role !== 'owner' && job.requested_by !== scope.actorUserId) {
      throw httpError(403, 'subject_request_not_authorized', 'Data subject request is not authorized')
    }
    return subjectJobDto(job)
  }

  async subjectExports(scope: LifecycleScope) {
    const jobs = await new LifecycleRepository(this.database).subjectJobs({
      tenantId: scope.tenantId, projectId: scope.projectId, actorUserId: scope.actorUserId, kind: 'subject_export', owner: scope.role === 'owner',
    })
    return { items: jobs.map(subjectJobDto) }
  }

  async subjectDeletions(scope: LifecycleScope) {
    const jobs = await new LifecycleRepository(this.database).subjectJobs({
      tenantId: scope.tenantId, projectId: scope.projectId, actorUserId: scope.actorUserId, kind: 'subject_deletion', owner: scope.role === 'owner',
    })
    return { items: jobs.map(subjectJobDto) }
  }

  async downloadSubjectExport(scope: LifecycleScope, jobId: unknown, rawToken: unknown) {
    if (!this.artifactStore) throw httpError(503, 'subject_export_artifact_store_unavailable', 'Data subject export storage is unavailable')
    const id = uuid(jobId, 'subject_job_not_found')
    const job = await new LifecycleRepository(this.database).subjectJob(scope.tenantId, scope.projectId, id)
    if (!job || job.kind !== 'subject_export' || (scope.role !== 'owner' && job.requested_by !== scope.actorUserId)) {
      throw httpError(404, 'subject_job_not_found', 'Data subject request was not found')
    }
    if (rawToken === undefined) {
      const token = randomBytes(32).toString('base64url')
      const issued = await issueSubjectExportDownloadToken(this.database, { tenantId: scope.tenantId, projectId: scope.projectId, jobId: id, actorUserId: scope.actorUserId, tokenHash: tokenHash(token) })
      if (!issued) throw httpError(404, 'subject_export_not_available', 'Data subject export is not available')
      return { token, expires_in_seconds: 900 }
    }
    if (typeof rawToken !== 'string' || rawToken.length < 32 || rawToken.length > 200) throw httpError(404, 'subject_export_not_available', 'Data subject export is not available')
    const target = await consumeSubjectExportDownloadToken(this.database, { tenantId: scope.tenantId, projectId: scope.projectId, jobId: id, actorUserId: scope.actorUserId, tokenHash: tokenHash(rawToken) })
    if (!target?.artifact_ref) throw httpError(404, 'subject_export_not_available', 'Data subject export is not available')
    const contents = await this.artifactStore.read(target.artifact_ref)
    if (!contents) throw httpError(404, 'subject_export_not_available', 'Data subject export is not available')
    return { contents }
  }

  async requestProjectDeletion(scope: LifecycleScope, idempotencyKey: unknown, raw: unknown, requestId?: string) {
    requireOwner(scope)
    const key = idempotency(idempotencyKey)
    const input = projectDeletionInput(raw)
    const repository = new LifecycleRepository(this.database)
    const existing = await repository.projectDeletionByIdempotency(scope.tenantId, scope.projectId, scope.actorUserId, key)
    if (existing) return { deletion: projectDeletionDto(existing), idempotent: true }
    const verification = await this.verify(scope, 'project_deletion', undefined, input.purpose, input.proof)
    if (!await repository.activeProject(scope.tenantId, scope.projectId)) {
      throw httpError(409, 'project_deletion_pending', 'Project is already frozen or deleted')
    }
    const effectiveAt = new Date(this.now().getTime() + PROJECT_CANCELLATION_WINDOW_MS)
    const requested = await repository.requestProjectDeletion({
      tenantId: scope.tenantId, projectId: scope.projectId, actorUserId: scope.actorUserId,
      verification, idempotencyKey: key, effectiveAt,
    })
    await new WorkerRepository(this.database).enqueueJob({
      id: randomUUID(), tenantId: scope.tenantId, projectId: scope.projectId, kind: 'project_deletion',
      idempotencyKey: `project-deletion:${requested.request.id}`, availableAt: requested.request.effective_at,
      payload: { project_deletion_request_id: requested.request.id },
    })
    if (requested.inserted) await repository.recordAudit({
      tenantId: scope.tenantId, actorUserId: scope.actorUserId, action: 'project_deletion_requested',
      targetType: 'project', targetId: scope.projectId, requestId,
      metadata: { verification_method: verification.method, cancellation_window_seconds: PROJECT_CANCELLATION_WINDOW_MS / 1000 },
    })
    return { deletion: projectDeletionDto(requested.request), idempotent: !requested.inserted }
  }

  async projectDeletion(scope: LifecycleScope) {
    requireOwner(scope)
    const deletion = await new LifecycleRepository(this.database).projectDeletion(scope.tenantId, scope.projectId)
    if (!deletion) throw httpError(404, 'project_deletion_not_found', 'Project deletion request was not found')
    return { deletion: { ...projectDeletionDto(deletion), project_status: deletion.project_status } }
  }

  async cancelProjectDeletion(scope: LifecycleScope, requestId?: string) {
    requireOwner(scope)
    const repository = new LifecycleRepository(this.database)
    const cancelled = await repository.cancelProjectDeletion(scope.tenantId, scope.projectId, scope.actorUserId)
    if (!cancelled) throw httpError(409, 'project_deletion_not_cancellable', 'Project deletion can no longer be cancelled')
    await repository.recordAudit({
      tenantId: scope.tenantId, actorUserId: scope.actorUserId, action: 'project_deletion_cancelled',
      targetType: 'project', targetId: scope.projectId, requestId, metadata: {},
    })
    return { deletion: projectDeletionDto(cancelled) }
  }

  private async requestSubjectJob(scope: LifecycleScope, kind: SubjectJobKind, idempotencyKey: unknown, raw: unknown, requestId?: string) {
    const key = idempotency(idempotencyKey)
    const input = subjectInput(raw)
    const repository = new LifecycleRepository(this.database)
    const existing = await repository.subjectJobByIdempotency(scope.tenantId, scope.projectId, scope.actorUserId, kind, key)
    if (existing) return { job: subjectJobDto(existing), idempotent: true }
    const verification = await this.verify(scope, kind, input.businessUserId, input.purpose, input.proof)
    if (scope.role !== 'owner' && verification.method !== 'verified_subject') {
      throw httpError(403, 'subject_request_not_authorized', 'Data subject request is not authorized')
    }
    if (!await repository.activeProject(scope.tenantId, scope.projectId)) throw httpError(409, 'project_deletion_pending', 'Project is frozen or deleted')
    const expiresAt = new Date(this.now().getTime() + SUBJECT_JOB_TTL_MS)
    const requested = await repository.enqueueSubjectJob({
      tenantId: scope.tenantId, projectId: scope.projectId, actorUserId: scope.actorUserId, kind,
      businessUserId: input.businessUserId, verification, scopeHash: scopeHash(scope.tenantId, scope.projectId, input.businessUserId),
      idempotencyKey: key, expiresAt,
    })
    await new WorkerRepository(this.database).enqueueJob({
      id: randomUUID(), tenantId: scope.tenantId, projectId: scope.projectId, kind,
      idempotencyKey: `${kind}:${requested.job.id}`, payload: { data_subject_job_id: requested.job.id },
    })
    // Schedule cleanup at the same durable expiry boundary. The handler
    // deletes private objects before removing their handles, so a completed
    // export cannot remain downloadable after its request lifetime.
    if (kind === 'subject_export' && requested.inserted) {
      await new WorkerRepository(this.database).enqueueJob({
        id: randomUUID(), tenantId: scope.tenantId, projectId: scope.projectId, kind: 'artifact_cleanup',
        idempotencyKey: `subject-export-cleanup:${requested.job.id}`,
        payload: { data_subject_job_id: requested.job.id }, availableAt: requested.job.expires_at,
      })
    }
    if (requested.inserted) await repository.recordAudit({
      tenantId: scope.tenantId, actorUserId: scope.actorUserId, action: `${kind}_requested`,
      targetType: 'data_subject_job', targetId: requested.job.id, requestId,
      metadata: { verification_method: verification.method },
    })
    return { job: subjectJobDto(requested.job), idempotent: !requested.inserted }
  }

  private async verify(scope: LifecycleScope, operation: SubjectJobKind | 'project_deletion', subjectBusinessUserId: string | undefined, purpose: string, proof: string) {
    const verification = await this.verifier.verify({ tenantId: scope.tenantId, projectId: scope.projectId, actorUserId: scope.actorUserId, operation, subjectBusinessUserId, purpose, proof })
    const now = this.now().getTime()
    if (!verification || !safeText(verification.method, 100) || !(verification.reauthenticatedAt instanceof Date)
      || !Number.isFinite(verification.reauthenticatedAt.getTime())
      || verification.reauthenticatedAt.getTime() > now + 60_000
      || verification.reauthenticatedAt.getTime() < now - REAUTH_MAX_AGE_MS) {
      throw httpError(403, 'lifecycle_verification_required', 'A current verified data-subject proof is required')
    }
    return verification
  }
}

export function subjectJobDto(job: LifecycleJobRecord) {
  return {
    id: job.id, kind: job.kind, status: job.status, subject_business_user_id: job.subject_business_user_id,
    verification_method: job.verification_method, reauthenticated_at: job.reauthenticated_at.toISOString(),
    created_at: job.created_at.toISOString(), started_at: job.started_at?.toISOString() ?? null,
    finished_at: job.finished_at?.toISOString() ?? null, expires_at: job.expires_at.toISOString(), reason_code: job.reason_code,
    byte_count: job.byte_count === null ? null : Number(job.byte_count),
  }
}

export function projectDeletionDto(request: ProjectDeletionRecord) {
  return { id: request.id, status: request.status, effective_at: request.effective_at.toISOString(), created_at: request.created_at.toISOString(), cancelled_at: request.cancelled_at?.toISOString() ?? null }
}

function requireOwner(scope: LifecycleScope) { if (scope.role !== 'owner') throw httpError(403, 'tenant_action_denied', 'Tenant action is denied') }
function tokenHash(value: string) { return createHash('sha256').update(value).digest() }
function scopeHash(tenantId: string, projectId: string, businessUserId: string) { return createHash('sha256').update(`${tenantId}\u0000${projectId}\u0000${businessUserId}`, 'utf8').digest() }
function idempotency(value: unknown) { if (!safeText(value, 200)) throw httpError(400, 'invalid_idempotency_key', 'Idempotency-Key is required'); return value }
function uuid(value: unknown, code: string) { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw httpError(404, code, 'Data subject request was not found'); return value }
function safeText(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max }
function subjectInput(raw: unknown): { businessUserId: string; purpose: string; proof: string } {
  const value = object(raw)
  if (!safeText(value.subject_business_user_id, 200) || !safeText(value.purpose, 500) || !safeText(value.proof, 2048)) throw httpError(400, 'invalid_subject_request', 'Data subject request is invalid')
  return { businessUserId: value.subject_business_user_id.trim(), purpose: value.purpose.trim(), proof: value.proof.trim() }
}
function projectDeletionInput(raw: unknown): { purpose: string; proof: string } {
  const value = object(raw)
  if (value.confirmation !== 'DELETE_PROJECT' || !safeText(value.purpose, 500) || !safeText(value.proof, 2048)) throw httpError(400, 'invalid_project_deletion', 'Project deletion confirmation is invalid')
  return { purpose: value.purpose.trim(), proof: value.proof.trim() }
}
function object(raw: unknown): Record<string, unknown> { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, 'invalid_lifecycle_request', 'Lifecycle request is invalid'); return raw as Record<string, unknown> }

export default class LifecycleService extends Service {
  async issueProof(scope: LifecycleScope, raw: unknown) {
    requireOwner(scope)
    const issuer = (this.app as { lifecycleProofIssuer?: LifecycleProofIssuer }).lifecycleProofIssuer
    if (!issuer) throw httpError(503, 'lifecycle_verification_unavailable', 'Lifecycle verification is unavailable')
    const input = lifecycleProofInput(raw)
    const issued = await issuer.issue({ ...scope, ...input })
    return { proof: issued.proof, expires_at: issued.expiresAt.toISOString() }
  }
  private domain(): LifecycleManagementService {
    const database = this.config.zhiji.database as DatabaseClient | undefined
    const verifier = (this.app as { lifecycleRequestVerifier?: LifecycleRequestVerifier }).lifecycleRequestVerifier
    if (!database || !('configured' in database) || !(database as { configured: boolean }).configured || !verifier) {
      throw httpError(503, 'lifecycle_verification_unavailable', 'Lifecycle verification is unavailable')
    }
    return new LifecycleManagementService(database, verifier, undefined, this.config.zhiji.analyticsExportArtifactStore)
  }
  requestSubjectExport(scope: LifecycleScope, key: unknown, raw: unknown, requestId?: string) { return this.domain().requestSubjectExport(scope, key, raw, requestId) }
  requestSubjectDeletion(scope: LifecycleScope, key: unknown, raw: unknown, requestId?: string) { return this.domain().requestSubjectDeletion(scope, key, raw, requestId) }
  subjectJob(scope: LifecycleScope, jobId: unknown) { return this.domain().subjectJob(scope, jobId) }
  subjectExports(scope: LifecycleScope) { return this.domain().subjectExports(scope) }
  subjectDeletions(scope: LifecycleScope) { return this.domain().subjectDeletions(scope) }
  downloadSubjectExport(scope: LifecycleScope, jobId: unknown, token: unknown) { return this.domain().downloadSubjectExport(scope, jobId, token) }
  requestProjectDeletion(scope: LifecycleScope, key: unknown, raw: unknown, requestId?: string) { return this.domain().requestProjectDeletion(scope, key, raw, requestId) }
  projectDeletion(scope: LifecycleScope) { return this.domain().projectDeletion(scope) }
  cancelProjectDeletion(scope: LifecycleScope, requestId?: string) { return this.domain().cancelProjectDeletion(scope, requestId) }
}

function lifecycleProofInput(raw: unknown): { operation: SubjectJobKind | 'project_deletion'; subjectBusinessUserId?: string; purpose: string; password: unknown } {
  const value = object(raw)
  const operation = value.operation
  if (operation !== 'subject_export' && operation !== 'subject_deletion' && operation !== 'project_deletion') throw httpError(400, 'invalid_lifecycle_verification', 'Lifecycle verification request is invalid')
  if (!safeText(value.purpose, 500)) throw httpError(400, 'invalid_lifecycle_verification', 'Lifecycle verification request is invalid')
  const subjectBusinessUserId = operation === 'project_deletion' ? undefined : value.subject_business_user_id
  if (operation !== 'project_deletion' && !safeText(subjectBusinessUserId, 200)) throw httpError(400, 'invalid_lifecycle_verification', 'Lifecycle verification request is invalid')
  return { operation, subjectBusinessUserId: typeof subjectBusinessUserId === 'string' ? subjectBusinessUserId.trim() : undefined, purpose: value.purpose.trim(), password: value.password }
}
