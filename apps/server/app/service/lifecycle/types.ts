import { DatabaseClient } from '../database/types'
import { MembershipRole } from '../database/types'

export type SubjectJobKind = 'subject_export' | 'subject_deletion'
export type SubjectJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'expired' | 'cancelled'
export type ProjectDeletionStatus = 'active' | 'pending' | 'deleting' | 'deleted'

export interface LifecycleScope {
  tenantId: string
  projectId: string
  actorUserId: string
  role: MembershipRole
}

export interface LifecycleVerification {
  method: string
  reauthenticatedAt: Date
}

export type LifecycleOperation = 'subject_export' | 'subject_deletion' | 'project_deletion'

export interface LifecycleProofIssuer {
  issue(input: {
    tenantId: string
    projectId: string
    actorUserId: string
    operation: LifecycleOperation
    subjectBusinessUserId?: string
    purpose: string
    password: unknown
  }): Promise<{ proof: string; expiresAt: Date }>
}

/**
 * The platform only stores the result of an application-owned proof flow. It
 * deliberately has no fallback accepting a client-provided reauthentication
 * timestamp or a fuzzy email lookup.
 */
export interface LifecycleRequestVerifier {
  verify(input: {
    tenantId: string
    projectId: string
    actorUserId: string
    operation: LifecycleOperation
    subjectBusinessUserId?: string
    purpose: string
    proof: string
  }): Promise<LifecycleVerification | null>
}

export interface LifecycleJobRecord {
  id: string
  requested_by: string
  kind: SubjectJobKind
  status: SubjectJobStatus
  subject_business_user_id: string
  verification_method: string
  reauthenticated_at: Date
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
  expires_at: Date
  reason_code: string | null
  artifact_ref: string | null
  byte_count: string | number | null
}

export interface ProjectDeletionRecord {
  id: string
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  effective_at: Date
  created_at: Date
  cancelled_at: Date | null
}

export interface LifecycleRepositoryDatabase extends DatabaseClient {}
