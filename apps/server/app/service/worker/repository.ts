import { randomUUID } from 'node:crypto'
import { EnqueueJobInput, EnqueueOutboxInput, LeasedOutboxMessage, LeasedWorkerJob, OutboxOutcome, WorkerRepositoryDatabase } from './types'

const DEFAULT_MAX_ATTEMPTS = 10

/**
 * PostgreSQL is the source of truth for work ownership.  Every mutation below
 * carries both worker id and a non-expired lease predicate, so a slow worker
 * cannot complete a job that a replacement worker has reclaimed.
 */
export class WorkerRepository {
  constructor(private readonly database: WorkerRepositoryDatabase) {}

  async enqueueOutbox(input: EnqueueOutboxInput): Promise<{ id: string; inserted: boolean }> {
    const result = await this.database.query<{ id: string; inserted: boolean }>(
      `INSERT INTO outbox_messages
         (id, tenant_id, project_id, topic, idempotency_key, payload, available_at, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7, now()), $8)
       ON CONFLICT (tenant_id, project_id, topic, idempotency_key) DO UPDATE SET id = outbox_messages.id
       RETURNING id, (xmax = 0) AS inserted`,
      [ input.id, input.tenantId, input.projectId, input.topic, input.idempotencyKey,
        JSON.stringify(input.payload), input.availableAt ?? null, input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS ],
    )
    const row = result.rows[0]
    if (!row) throw new Error('outbox enqueue did not return a row')
    return row
  }

  async claimOutbox(workerId: string, limit: number, leaseSeconds: number): Promise<LeasedOutboxMessage[]> {
    this.assertClaimArguments(workerId, limit, leaseSeconds)
    const result = await this.database.query<LeasedOutboxMessage>(
      `WITH candidates AS (
         SELECT id FROM outbox_messages
         WHERE delivered_at IS NULL AND discarded_at IS NULL
           AND available_at <= now() AND attempt_count < max_attempts
           AND (lease_expires_at IS NULL OR lease_expires_at <= now())
         ORDER BY available_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE outbox_messages AS message
       SET lease_owner = $2, lease_expires_at = now() + ($3 * interval '1 second'),
           attempt_count = attempt_count + 1, updated_at = now()
       FROM candidates WHERE message.id = candidates.id
       RETURNING message.id, message.tenant_id, message.project_id, message.topic, message.idempotency_key,
                 message.payload, message.available_at, message.lease_owner, message.lease_expires_at,
                 message.attempt_count, message.max_attempts`,
      [ limit, workerId, leaseSeconds ],
    )
    return result.rows
  }

  async markOutboxDelivered(id: string, workerId: string): Promise<boolean> {
    return this.finishOutbox(id, workerId, 'delivered')
  }

  async renewOutboxLease(id: string, workerId: string, leaseSeconds: number): Promise<boolean> {
    this.assertClaimArguments(workerId, 1, leaseSeconds)
    const result = await this.database.query<{ id: string }>(
      `UPDATE outbox_messages
       SET lease_expires_at = now() + ($3 * interval '1 second'), updated_at = now()
       WHERE id = $1 AND lease_owner = $2 AND lease_expires_at > now()
         AND delivered_at IS NULL AND discarded_at IS NULL
       RETURNING id`,
      [ id, workerId, leaseSeconds ],
    )
    return result.rowCount === 1
  }

  async retryOutbox(id: string, workerId: string, errorCode: string, availableAt: Date): Promise<boolean> {
    const result = await this.database.query<{ id: string }>(
      `WITH updated AS (
         UPDATE outbox_messages
         SET lease_owner = NULL, lease_expires_at = NULL, available_at = $4,
             last_error_code = $3, updated_at = now()
         WHERE id = $1 AND lease_owner = $2 AND lease_expires_at > now()
           AND delivered_at IS NULL AND discarded_at IS NULL
         RETURNING id, attempt_count
       ), audit AS (
         INSERT INTO outbox_attempts (id, outbox_id, worker_id, attempt_number, outcome, error_code)
         SELECT $5, id, $2, attempt_count, 'retry_scheduled', $3 FROM updated
       ) SELECT id FROM updated`,
      [ id, workerId, errorCode, availableAt, randomUUID() ],
    )
    return result.rowCount === 1
  }

  async discardOutbox(id: string, workerId: string, errorCode: string): Promise<boolean> {
    return this.finishOutbox(id, workerId, 'discarded', errorCode)
  }

  async enqueueJob(input: EnqueueJobInput): Promise<{ id: string; inserted: boolean }> {
    const result = await this.database.query<{ id: string; inserted: boolean }>(
      `INSERT INTO worker_jobs
         (id, tenant_id, project_id, kind, idempotency_key, payload, available_at, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7, now()), $8)
       ON CONFLICT (tenant_id, project_id, kind, idempotency_key) DO UPDATE SET id = worker_jobs.id
       RETURNING id, (xmax = 0) AS inserted`,
      [ input.id, input.tenantId, input.projectId, input.kind, input.idempotencyKey,
        JSON.stringify(input.payload ?? {}), input.availableAt ?? null, input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS ],
    )
    const row = result.rows[0]
    if (!row) throw new Error('job enqueue did not return a row')
    return row
  }

  async claimJobs(workerId: string, limit: number, leaseSeconds: number): Promise<LeasedWorkerJob[]> {
    this.assertClaimArguments(workerId, limit, leaseSeconds)
    const result = await this.database.query<LeasedWorkerJob>(
      `WITH candidates AS (
         SELECT id FROM worker_jobs
         WHERE status IN ('queued', 'running') AND available_at <= now()
           AND attempt_count < max_attempts
           AND (lease_expires_at IS NULL OR lease_expires_at <= now())
         ORDER BY available_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE worker_jobs AS job
       SET status = 'running', lease_owner = $2,
           lease_expires_at = now() + ($3 * interval '1 second'),
           attempt_count = attempt_count + 1, started_at = COALESCE(started_at, now()), updated_at = now()
       FROM candidates WHERE job.id = candidates.id
       RETURNING job.id, job.tenant_id, job.project_id, job.kind, job.idempotency_key,
                 job.payload, job.watermark, job.lease_owner, job.lease_expires_at, job.attempt_count,
                 job.max_attempts, job.processed_count, job.failed_count`,
      [ limit, workerId, leaseSeconds ],
    )
    return result.rows
  }

  async completeJob(input: { id: string; workerId: string; processedCount: number; failedCount: number; watermark?: Record<string, unknown> }): Promise<boolean> {
    const result = await this.database.query<{ id: string }>(
      `WITH updated AS (
         UPDATE worker_jobs
         SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
             processed_count = processed_count + $3, failed_count = failed_count + $4,
             watermark = COALESCE($5::jsonb, watermark), finished_at = now(), updated_at = now()
         WHERE id = $1 AND lease_owner = $2 AND lease_expires_at > now() AND status = 'running'
         RETURNING id, attempt_count
       ), audit AS (
         INSERT INTO worker_job_runs (id, job_id, worker_id, attempt_number, outcome, processed_count, failed_count)
         SELECT $6, id, $2, attempt_count, 'succeeded', $3, $4 FROM updated
       ) SELECT id FROM updated`,
      [ input.id, input.workerId, input.processedCount, input.failedCount,
        input.watermark ? JSON.stringify(input.watermark) : null, randomUUID() ],
    )
    return result.rowCount === 1
  }

  async renewJobLease(id: string, workerId: string, leaseSeconds: number): Promise<boolean> {
    this.assertClaimArguments(workerId, 1, leaseSeconds)
    const result = await this.database.query<{ id: string }>(
      `UPDATE worker_jobs
       SET lease_expires_at = now() + ($3 * interval '1 second'), updated_at = now()
       WHERE id = $1 AND lease_owner = $2 AND lease_expires_at > now() AND status = 'running'
       RETURNING id`,
      [ id, workerId, leaseSeconds ],
    )
    return result.rowCount === 1
  }

  async retryJob(input: { id: string; workerId: string; errorCode: string; availableAt: Date; processedCount?: number; failedCount?: number; watermark?: Record<string, unknown> }): Promise<boolean> {
    const result = await this.database.query<{ id: string }>(
      `WITH updated AS (
         UPDATE worker_jobs
         SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, available_at = $4,
             last_error_code = $3, processed_count = processed_count + $5, failed_count = failed_count + $6,
             watermark = COALESCE($7::jsonb, watermark), updated_at = now()
         WHERE id = $1 AND lease_owner = $2 AND lease_expires_at > now() AND status = 'running'
         RETURNING id, attempt_count
       ), audit AS (
         INSERT INTO worker_job_runs (id, job_id, worker_id, attempt_number, outcome, processed_count, failed_count, error_code)
         SELECT $8, id, $2, attempt_count, 'retry_scheduled', $5, $6, $3 FROM updated
       ) SELECT id FROM updated`,
      [ input.id, input.workerId, input.errorCode, input.availableAt, input.processedCount ?? 0,
        input.failedCount ?? 0, input.watermark ? JSON.stringify(input.watermark) : null, randomUUID() ],
    )
    return result.rowCount === 1
  }

  async failJob(id: string, workerId: string, errorCode: string): Promise<boolean> {
    const result = await this.database.query<{ id: string }>(
      `WITH updated AS (
         UPDATE worker_jobs
         SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
             last_error_code = $3, finished_at = now(), updated_at = now()
         WHERE id = $1 AND lease_owner = $2 AND lease_expires_at > now() AND status = 'running'
         RETURNING id, attempt_count
       ), audit AS (
         INSERT INTO worker_job_runs (id, job_id, worker_id, attempt_number, outcome, error_code)
         SELECT $4, id, $2, attempt_count, 'failed', $3 FROM updated
       ) SELECT id FROM updated`,
      [ id, workerId, errorCode, randomUUID() ],
    )
    return result.rowCount === 1
  }

  private async finishOutbox(id: string, workerId: string, outcome: Extract<OutboxOutcome, 'delivered' | 'discarded'>, errorCode?: string): Promise<boolean> {
    const terminalColumn = outcome === 'delivered' ? 'delivered_at' : 'discarded_at'
    const result = await this.database.query<{ id: string }>(
      `WITH updated AS (
         UPDATE outbox_messages
         SET ${terminalColumn} = now(), lease_owner = NULL, lease_expires_at = NULL,
             last_error_code = $3, updated_at = now()
         WHERE id = $1 AND lease_owner = $2 AND lease_expires_at > now()
           AND delivered_at IS NULL AND discarded_at IS NULL
         RETURNING id, attempt_count
       ), audit AS (
         INSERT INTO outbox_attempts (id, outbox_id, worker_id, attempt_number, outcome, error_code)
         SELECT $4, id, $2, attempt_count, '${outcome}', $3 FROM updated
       ) SELECT id FROM updated`,
      [ id, workerId, errorCode ?? null, randomUUID() ],
    )
    return result.rowCount === 1
  }

  private assertClaimArguments(workerId: string, limit: number, leaseSeconds: number): void {
    if (workerId.length < 1 || workerId.length > 200) throw new Error('workerId must contain 1 to 200 characters')
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100')
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) throw new Error('leaseSeconds must be an integer from 1 to 3600')
  }
}
