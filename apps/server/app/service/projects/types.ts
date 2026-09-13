import type { BehaviorCapturePolicy, CapturePolicy, DataLifecyclePolicy, ManagementProject, MobileApplicationPolicy, PageCapturePolicy, ProjectManagementPolicy, ProjectPolicyInput } from '@zhiji/contracts'
import { ProjectKeyType } from '../database/types'

export type { BehaviorCapturePolicy, DataLifecyclePolicy, MobileApplicationPolicy, PageCapturePolicy, ProjectPolicyValue } from '@zhiji/contracts'

export const PROJECT_KEY_TYPES = [ 'browser', 'server', 'mobile', 'otel', 'sourcemap_upload' ] as const

export interface TenantProjectScope {
  tenantId: string
  userId: string
  /** Role decides allowed actions; every non-owner role also needs an explicit project grant. */
  role: 'owner' | 'admin' | 'member' | 'viewer'
}

export type ProjectPolicyDto = ProjectManagementPolicy
export type ProjectCapturePolicy = CapturePolicy

export interface ProjectRecord {
  id: string
  tenant_id: string
  name: string
  allowed_origins: string[]
  core_event_names: string[]
  page_capture: PageCapturePolicy
  mobile_applications: MobileApplicationPolicy[]
  retention_days: number | null
  data_lifecycle_policy: DataLifecyclePolicy | null
  event_quota: number | null
  behavior_capture: BehaviorCapturePolicy
  session_replay: ProjectCapturePolicy & Record<string, unknown>
  performance_capture: ProjectCapturePolicy
  policy_version: number
  created_at: Date
}

export interface TenantDefaults {
  retention_days: number
  data_lifecycle_policy: DataLifecyclePolicy
  event_quota: number
}

export type ProjectDto = ManagementProject

export interface ProjectKeyRecord {
  id: string
  tenant_id: string
  project_id: string
  key_type: ProjectKeyType
  label: string
  prefix: string
  key_hash: Buffer
  created_at: Date
  disabled_at: Date | null
}

export interface ProjectKeyDto {
  id: string
  key_type: ProjectKeyType
  label: string
  prefix: string
  created_at: string
  disabled_at: string | null
}

export interface CreatedProjectKey {
  key: ProjectKeyDto
  /** This value is intentionally not stored and is shown exactly once. */
  secret: string
}

export interface CreateProjectInput {
  name: string
  allowed_origins?: string[]
  core_event_names?: string[]
  page_capture?: PageCapturePolicy
  mobile_applications?: MobileApplicationPolicy[]
  policy?: ProjectPolicyInput
  behavior_capture?: BehaviorCapturePolicy
  session_replay?: ProjectCapturePolicy & Record<string, unknown>
  performance_capture?: ProjectCapturePolicy
}

export interface UpdateProjectInput {
  name?: string
  allowed_origins?: string[]
  core_event_names?: string[]
  page_capture?: PageCapturePolicy
  mobile_applications?: MobileApplicationPolicy[]
  policy?: ProjectPolicyInput
  behavior_capture?: BehaviorCapturePolicy
  session_replay?: ProjectCapturePolicy & Record<string, unknown>
  performance_capture?: ProjectCapturePolicy
}

export interface ProjectStore {
  getTenantDefaults(tenantId: string): Promise<TenantDefaults | null>
  activeRetentionDaysMax(tenantId: string): Promise<number | null>
  getProject(tenantId: string, projectId: string): Promise<ProjectRecord | null>
  listProjects(tenantId: string, userId: string, includeAll: boolean): Promise<ProjectRecord[]>
  createProject(record: ProjectRecord): Promise<void>
  updateProject(record: ProjectRecord): Promise<void>
  listKeys(tenantId: string, projectId: string): Promise<ProjectKeyRecord[]>
  getKey(tenantId: string, projectId: string, keyId: string): Promise<ProjectKeyRecord | null>
  createKey(record: ProjectKeyRecord): Promise<void>
  disableKey(tenantId: string, projectId: string, keyId: string, disabledAt: Date): Promise<ProjectKeyRecord | null>
}
