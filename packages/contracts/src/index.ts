export interface ResponseMeta {
  request_id: string
}

export interface ApiSuccess<T> {
  data: T
  meta: ResponseMeta
}

export interface ApiFailure {
  error: {
    code: string
    message: string
    details?: Record<string, string>
  }
  meta: ResponseMeta
}

export interface SdkConfigRequest {
  key: string
  origin: string
  ifNoneMatch?: string
}

export interface BrowserCapturePolicy {
  enabled: boolean
  policy_version: number
}

/** Complete, public behavior policy. It deliberately excludes element HMAC material. */
export interface BrowserBehaviorCapturePolicy extends BrowserCapturePolicy {
  page_allowlist: string[]
  track_ids: string[]
  block_selectors: string[]
  sample_rate: number
}

export interface SdkConfig {
  project_id: string
  policy_version: number
  cache_max_age_seconds: number
  page_rules: {
    allowed_page_keys: string[]
  }
  behavior_capture: BrowserBehaviorCapturePolicy
  session_replay: BrowserCapturePolicy & {
    sample_rate: number
    page_allowlist: string[]
    max_session_seconds: number
    max_session_bytes: number
  }
  performance_capture: BrowserCapturePolicy
}

export type SdkConfigResponse = ApiSuccess<SdkConfig>

export interface HealthStatus {
  status: 'ok' | 'unavailable'
  checks: Record<string, 'ok' | 'unavailable'>
}

/** Named retention categories accepted by the tenant and project management APIs. */
export const DATA_LIFECYCLE_FIELDS = [
  'raw_event_days', 'error_occurrence_days', 'behavior_raw_days', 'replay_raw_days',
  'performance_raw_days', 'aggregate_days', 'backup_expiry_days',
] as const

export type DataLifecycleField = typeof DATA_LIFECYCLE_FIELDS[number]
export type DataLifecyclePolicy = Record<DataLifecycleField, number>

/** Privacy ceilings that no tenant or project override may expand. */
export const DATA_LIFECYCLE_CAPS: Readonly<Partial<DataLifecyclePolicy>> = {
  error_occurrence_days: 90,
  behavior_raw_days: 14,
  replay_raw_days: 7,
  performance_raw_days: 30,
}

export const DEFAULT_DATA_LIFECYCLE_POLICY: DataLifecyclePolicy = {
  raw_event_days: 365,
  error_occurrence_days: 90,
  behavior_raw_days: 14,
  replay_raw_days: 7,
  performance_raw_days: 30,
  aggregate_days: 365,
  backup_expiry_days: 30,
}

/** Strictly validates the persisted/request representation; unknown fields are rejected. */
export function parseDataLifecyclePolicy(value: unknown): DataLifecyclePolicy | null {
  if (!isPlainRecord(value) || Object.keys(value).length !== DATA_LIFECYCLE_FIELDS.length || !DATA_LIFECYCLE_FIELDS.every(key => Object.prototype.hasOwnProperty.call(value, key))) return null
  const policy = {} as DataLifecyclePolicy
  for (const key of DATA_LIFECYCLE_FIELDS) {
    const days = value[key]
    if (typeof days !== 'number' || !Number.isSafeInteger(days) || days < 1 || days > 10_000_000) return null
    policy[key] = days
  }
  return policy
}

export function effectiveDataLifecyclePolicy(configured: DataLifecyclePolicy | null | undefined, fallback: DataLifecyclePolicy = DEFAULT_DATA_LIFECYCLE_POLICY): DataLifecyclePolicy {
  const source = configured ?? fallback
  return Object.fromEntries(DATA_LIFECYCLE_FIELDS.map(key => [key, Math.min(source[key], DATA_LIFECYCLE_CAPS[key] ?? source[key])])) as DataLifecyclePolicy
}

export function legacyDataLifecyclePolicy(retentionDays: number): DataLifecyclePolicy {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) throw new Error('invalid_legacy_retention_days')
  return effectiveDataLifecyclePolicy({ ...DEFAULT_DATA_LIFECYCLE_POLICY, raw_event_days: retentionDays, error_occurrence_days: retentionDays, behavior_raw_days: retentionDays, replay_raw_days: retentionDays, performance_raw_days: retentionDays, aggregate_days: retentionDays })
}

export interface CapturePolicy { enabled: boolean; policy_version: number }
export interface PageCapturePolicy { allowed_page_keys: string[]; route_templates: string[] }
export interface BehaviorCapturePolicy extends CapturePolicy {
  page_allowlist: string[]
  track_ids: string[]
  block_selectors: string[]
  sample_rate: number
}
export interface MobileApplicationPolicy {
  platform: 'ios' | 'android' | 'react_native'
  application_id: string
  min_version: string
  max_version?: string
}
export interface ProjectPolicyValue {
  configured: number | null
  effective: number
  source: 'tenant_default' | 'project_override'
}
export interface DataLifecyclePolicyValue {
  configured: DataLifecyclePolicy | null
  effective: DataLifecyclePolicy
  source: 'tenant_default' | 'project_override'
}
export interface ProjectManagementPolicy {
  retention_days: ProjectPolicyValue
  data_lifecycle_policy: DataLifecyclePolicyValue
  event_quota: ProjectPolicyValue
  enforcement_enabled: false
}

/** Public project representation returned by management endpoints. */
export interface ManagementProject {
  id: string
  name: string
  allowed_origins: string[]
  core_event_names: string[]
  page_capture: PageCapturePolicy
  mobile_applications: MobileApplicationPolicy[]
  policy: ProjectManagementPolicy
  behavior_capture: BehaviorCapturePolicy
  session_replay: CapturePolicy & Record<string, unknown>
  performance_capture: CapturePolicy
  created_at: string
}
export interface ProjectPolicyInput {
  retention_days?: number | null
  data_lifecycle_policy?: DataLifecyclePolicy | null
  event_quota?: number | null
}
export interface ManagementProjectInput {
  name?: string
  allowed_origins?: string[]
  core_event_names?: string[]
  page_capture?: PageCapturePolicy
  mobile_applications?: MobileApplicationPolicy[]
  policy?: ProjectPolicyInput
  behavior_capture?: BehaviorCapturePolicy
  session_replay?: CapturePolicy & Record<string, unknown>
  performance_capture?: CapturePolicy
}
export interface TenantDefaultsResponse {
  id: string
  retention_days: number
  data_lifecycle_policy: DataLifecyclePolicy
  event_quota: number
}
export interface TenantDefaultsInput {
  retention_days?: number
  data_lifecycle_policy?: DataLifecyclePolicy
  event_quota?: number
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}
