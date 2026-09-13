import { DatabaseClient } from '../database/types'

export type WorkerJobKind =
  | 'retention_cleanup'
  | 'subject_export'
  | 'subject_deletion'
  | 'project_deletion'
  | 'artifact_cleanup'
  | 'replay_object_cleanup'
  | 'sourcemap_cleanup'
  | 'report_export'
  | 'alert_evaluation'
  | 'report_schedule_run'

export type WorkerJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type OutboxOutcome = 'delivered' | 'retry_scheduled' | 'discarded' | 'lease_released'
export type JobOutcome = 'succeeded' | 'retry_scheduled' | 'failed' | 'lease_released'

export interface LeasedOutboxMessage {
  id: string
  tenant_id: string
  project_id: string
  topic: string
  idempotency_key: string
  payload: Record<string, unknown>
  available_at: Date
  lease_owner: string
  lease_expires_at: Date
  attempt_count: number
  max_attempts: number
}

export interface LeasedWorkerJob {
  id: string
  tenant_id: string
  project_id: string
  kind: WorkerJobKind
  idempotency_key: string
  payload: Record<string, unknown>
  watermark: Record<string, unknown>
  lease_owner: string
  lease_expires_at: Date
  attempt_count: number
  max_attempts: number
  processed_count: number
  failed_count: number
}

export interface EnqueueOutboxInput {
  id: string
  tenantId: string
  projectId: string
  topic: string
  idempotencyKey: string
  payload: Record<string, unknown>
  availableAt?: Date
  maxAttempts?: number
}

export interface EnqueueJobInput {
  id: string
  tenantId: string
  projectId: string
  kind: WorkerJobKind
  idempotencyKey: string
  payload?: Record<string, unknown>
  availableAt?: Date
  maxAttempts?: number
}

export interface WorkerRepositoryDatabase extends DatabaseClient {}
