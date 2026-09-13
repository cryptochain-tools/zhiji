import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { DataLifecyclePolicy, effectiveDataLifecyclePolicy, parseDataLifecyclePolicy } from '../lifecycle/policy'
import { normalizeOrigin } from '../sdkConfig'
import {
  CreateProjectInput,
  CreatedProjectKey,
  PROJECT_KEY_TYPES,
  ProjectDto,
  ProjectKeyDto,
  ProjectKeyRecord,
  BehaviorCapturePolicy,
  PageCapturePolicy,
  MobileApplicationPolicy,
  ProjectRecord,
  ProjectStore,
  TenantDefaults,
  TenantProjectScope,
  UpdateProjectInput,
} from './types'

export * from './types'

const MAX_EVENT_NAMES = 5

function requireManager(scope: TenantProjectScope) {
  if (scope.role !== 'owner' && scope.role !== 'admin') {
    throw httpError(403, 'forbidden', 'Project management requires owner or admin role')
  }
}

function requireOwner(scope: TenantProjectScope) {
  if (scope.role !== 'owner') throw httpError(403, 'forbidden', 'Project creation requires owner role')
}

function requiredText(value: string, field: string, max: number): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > max) {
    throw httpError(400, 'invalid_project', `${field} must contain 1 to ${max} characters`)
  }
  return normalized
}

function positiveOrNull(value: number | null | undefined, field: string): number | null | undefined {
  if (value === undefined || value === null) return value
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw httpError(400, 'invalid_policy', `${field} must be a positive integer or null`)
  }
  return value
}
function lifecycleOrNull(value: unknown) { if (value === undefined || value === null) return null; const policy = parseDataLifecyclePolicy(value); if (!policy) throw httpError(400, 'invalid_policy', 'data_lifecycle_policy is invalid'); return policy }

function normalizeOrigins(origins: string[] | undefined): string[] | undefined {
  if (origins === undefined) return undefined
  if (origins.length > 100) throw httpError(400, 'invalid_project', 'allowed_origins exceeds 100 entries')
  const normalized = origins.map(origin => normalizeOrigin(origin))
  if (normalized.some(origin => origin === null)) {
    throw httpError(400, 'invalid_project', 'allowed_origins must contain exact HTTP(S) origins')
  }
  return [ ...new Set(normalized as string[]) ]
}

function normalizeEventNames(names: string[] | undefined): string[] | undefined {
  if (names === undefined) return undefined
  if (names.length > MAX_EVENT_NAMES) {
    throw httpError(400, 'invalid_project', `core_event_names supports at most ${MAX_EVENT_NAMES} events`)
  }
  const normalized = names.map(name => requiredText(name, 'core event name', 100))
  return [ ...new Set(normalized) ]
}

function normalizePageCapture(value: PageCapturePolicy | undefined): PageCapturePolicy | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'invalid_policy', 'page_capture must be an object')
  const keys = normalizePageValues(value.allowed_page_keys, 'allowed_page_keys')
  const templates = normalizePageValues(value.route_templates, 'route_templates', true)
  return { allowed_page_keys: keys, route_templates: templates }
}
function normalizeMobileApplications(value: MobileApplicationPolicy[] | undefined): MobileApplicationPolicy[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 100) throw httpError(400, 'invalid_policy', 'mobile_applications is invalid')
  const seen = new Set<string>()
  return value.map(application => {
    if (!application || typeof application !== 'object' || Array.isArray(application)) throw httpError(400, 'invalid_policy', 'mobile_applications is invalid')
    if (!['ios', 'android', 'react_native'].includes(application.platform)) throw httpError(400, 'invalid_policy', 'mobile_applications.platform is invalid')
    const applicationId = requiredText(application.application_id, 'mobile application_id', 255)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(applicationId)) throw httpError(400, 'invalid_policy', 'mobile application_id is invalid')
    const minVersion = mobileVersion(application.min_version, 'min_version')
    const maxVersion = application.max_version === undefined ? undefined : mobileVersion(application.max_version, 'max_version')
    if (maxVersion && compareVersions(minVersion, maxVersion) > 0) throw httpError(400, 'invalid_policy', 'mobile application version range is invalid')
    const key = `${application.platform}:${applicationId}`
    if (seen.has(key)) throw httpError(400, 'invalid_policy', 'mobile applications must be unique by platform and application_id')
    seen.add(key)
    return { platform: application.platform, application_id: applicationId, min_version: minVersion, ...(maxVersion ? { max_version: maxVersion } : {}) }
  })
}
function mobileVersion(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(value) || value.length > 64) throw httpError(400, 'invalid_policy', `mobile ${field} is invalid`)
  return value
}
function compareVersions(left: string, right: string): number {
  const values = (value: string) => value.split(/[+-]/, 1)[0]!.split('.').map(Number)
  const a = values(left), b = values(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) { const result = (a[index] ?? 0) - (b[index] ?? 0); if (result) return result }
  return 0
}
function normalizePageValues(value: unknown, field: string, templates = false): string[] {
  if (!Array.isArray(value) || value.length > 500) throw httpError(400, 'invalid_policy', `page_capture.${field} is invalid`)
  const normalized = value.map(item => {
    if (typeof item !== 'string' || item.length < 1 || item.length > 512 || item.trim() !== item || !item.startsWith('/') || /[?#@]/.test(item)) {
      throw httpError(400, 'invalid_policy', `page_capture.${field} is invalid`)
    }
    if (templates && !item.split('/').every(part => part === '' || /^:[A-Za-z][A-Za-z0-9_]*$/.test(part) || /^[A-Za-z0-9._~-]+$/.test(part))) {
      throw httpError(400, 'invalid_policy', `page_capture.${field} is invalid`)
    }
    return item
  })
  return [ ...new Set(normalized) ]
}

function validateCapturePolicy(policy: unknown, field: string) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw httpError(400, 'invalid_policy', `${field} must be an object`)
  }
  const value = policy as { enabled?: unknown; policy_version?: unknown }
  if (typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.policy_version) || Number(value.policy_version) <= 0) {
    throw httpError(400, 'invalid_policy', `${field} requires enabled and positive policy_version`)
  }
}

function disabledBehaviorCapture(): BehaviorCapturePolicy {
  return { enabled: false, policy_version: 1, page_allowlist: [], track_ids: [], block_selectors: [], sample_rate: 0 }
}

function validateBehaviorCapturePolicy(policy: unknown) {
  validateCapturePolicy(policy, 'behavior_capture')
  const value = policy as Partial<BehaviorCapturePolicy>
  const pages = normalizePageValues(value.page_allowlist, 'behavior_capture.page_allowlist')
  if (!Array.isArray(value.track_ids) || value.track_ids.length > 500 || value.track_ids.some(token => typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(token))) {
    throw httpError(400, 'invalid_policy', 'behavior_capture.track_ids is invalid')
  }
  if (!Array.isArray(value.block_selectors) || value.block_selectors.length > 500 || value.block_selectors.some(selector => typeof selector !== 'string' || selector.length < 1 || selector.length > 200 || /[\n\r]/.test(selector))) {
    throw httpError(400, 'invalid_policy', 'behavior_capture.block_selectors is invalid')
  }
  if (typeof value.sample_rate !== 'number' || !Number.isFinite(value.sample_rate) || value.sample_rate < 0 || value.sample_rate > 1) {
    throw httpError(400, 'invalid_policy', 'behavior_capture.sample_rate is invalid')
  }
  if (value.enabled && (pages.length === 0 || value.track_ids.length === 0 || value.sample_rate <= 0)) {
    throw httpError(400, 'invalid_policy', 'enabled behavior_capture requires pages, track IDs, and a positive sample rate')
  }
}

function toPolicy(record: ProjectRecord, defaults: TenantDefaults): ProjectDto['policy'] {
  const makeValue = (configured: number | null, effective: number) => ({
    configured,
    effective,
    source: configured === null ? 'tenant_default' as const : 'project_override' as const,
  })
  return {
    retention_days: makeValue(record.retention_days, record.retention_days ?? defaults.retention_days),
    data_lifecycle_policy: { configured: record.data_lifecycle_policy, effective: effectiveDataLifecyclePolicy(record.data_lifecycle_policy, defaults.data_lifecycle_policy), source: record.data_lifecycle_policy === null ? 'tenant_default' : 'project_override' },
    event_quota: makeValue(record.event_quota, record.event_quota ?? defaults.event_quota),
    enforcement_enabled: false,
  }
}

export function projectDto(record: ProjectRecord, defaults: TenantDefaults): ProjectDto {
  return {
    id: record.id,
    name: record.name,
    allowed_origins: [ ...record.allowed_origins ],
    core_event_names: [ ...record.core_event_names ],
    page_capture: { allowed_page_keys: [ ...record.page_capture.allowed_page_keys ], route_templates: [ ...record.page_capture.route_templates ] },
    mobile_applications: record.mobile_applications.map(item => ({ ...item })),
    policy: toPolicy(record, defaults),
    behavior_capture: { ...record.behavior_capture, page_allowlist: [ ...record.behavior_capture.page_allowlist ], track_ids: [ ...record.behavior_capture.track_ids ], block_selectors: [ ...record.behavior_capture.block_selectors ] },
    session_replay: { ...record.session_replay },
    performance_capture: { ...record.performance_capture },
    created_at: record.created_at.toISOString(),
  }
}

export function projectKeyDto(record: ProjectKeyRecord): ProjectKeyDto {
  return {
    id: record.id,
    key_type: record.key_type,
    label: record.label,
    prefix: record.prefix,
    created_at: record.created_at.toISOString(),
    disabled_at: record.disabled_at?.toISOString() ?? null,
  }
}

export function hashProjectKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

export function createProjectKeySecret(keyType: ProjectKeyRecord['key_type']): { secret: string; prefix: string } {
  const code = keyType === 'sourcemap_upload' ? 'sm' : keyType.slice(0, 3)
  const value = randomBytes(32).toString('base64url')
  const secret = `zj_${code}_${value}`
  // Prefix is an opaque display hint. It is never used for authorization.
  return { secret, prefix: secret.slice(0, 14) }
}

/**
 * Store-driven domain service. The production store is deliberately installed
 * later with tenant-scoped SQL; unit tests use an in-memory store.
 */
export class ProjectsDomainService {
  constructor(private readonly store: ProjectStore) {}

  private async defaults(tenantId: string): Promise<TenantDefaults> {
    const defaults = await this.store.getTenantDefaults(tenantId)
    if (!defaults) throw httpError(404, 'tenant_not_found', 'Tenant was not found')
    return defaults
  }

  async list(scope: TenantProjectScope): Promise<ProjectDto[]> {
    const defaults = await this.defaults(scope.tenantId)
    const records = await this.store.listProjects(scope.tenantId, scope.userId, scope.role === 'owner')
    return records.map(record => projectDto(record, defaults))
  }

  async create(scope: TenantProjectScope, input: CreateProjectInput): Promise<ProjectDto> {
    requireOwner(scope)
    const defaults = await this.defaults(scope.tenantId)
    const record: ProjectRecord = {
      id: randomUUID(),
      tenant_id: scope.tenantId,
      name: requiredText(input.name, 'name', 200),
      allowed_origins: normalizeOrigins(input.allowed_origins) ?? [],
      core_event_names: normalizeEventNames(input.core_event_names) ?? [],
      page_capture: normalizePageCapture(input.page_capture) ?? { allowed_page_keys: [], route_templates: [] },
      mobile_applications: normalizeMobileApplications(input.mobile_applications) ?? [],
      retention_days: positiveOrNull(input.policy?.retention_days, 'retention_days') ?? null,
      data_lifecycle_policy: lifecycleOrNull(input.policy?.data_lifecycle_policy),
      event_quota: positiveOrNull(input.policy?.event_quota, 'event_quota') ?? null,
      behavior_capture: input.behavior_capture ?? disabledBehaviorCapture(),
      session_replay: input.session_replay ?? { enabled: false, policy_version: 1 },
      performance_capture: input.performance_capture ?? { enabled: false, policy_version: 1 },
      policy_version: 1,
      created_at: new Date(),
    }
    validateBehaviorCapturePolicy(record.behavior_capture)
    validateCapturePolicy(record.session_replay, 'session_replay')
    validateCapturePolicy(record.performance_capture, 'performance_capture')
    await this.assertRetentionLimit(scope.tenantId, record.retention_days, record.data_lifecycle_policy)
    await this.store.createProject(record)
    return projectDto(record, defaults)
  }

  async update(scope: TenantProjectScope, projectId: string, input: UpdateProjectInput): Promise<ProjectDto> {
    requireManager(scope)
    const defaults = await this.defaults(scope.tenantId)
    const current = await this.store.getProject(scope.tenantId, projectId)
    if (!current) throw httpError(404, 'project_not_found', 'Project was not found')
    const next: ProjectRecord = {
      ...current,
      name: input.name === undefined ? current.name : requiredText(input.name, 'name', 200),
      allowed_origins: normalizeOrigins(input.allowed_origins) ?? current.allowed_origins,
      core_event_names: normalizeEventNames(input.core_event_names) ?? current.core_event_names,
      page_capture: normalizePageCapture(input.page_capture) ?? current.page_capture,
      mobile_applications: normalizeMobileApplications(input.mobile_applications) ?? current.mobile_applications,
      retention_days: input.policy?.retention_days === undefined ? current.retention_days : positiveOrNull(input.policy.retention_days, 'retention_days') ?? null,
      data_lifecycle_policy: input.policy?.data_lifecycle_policy === undefined ? current.data_lifecycle_policy : lifecycleOrNull(input.policy.data_lifecycle_policy),
      event_quota: input.policy?.event_quota === undefined ? current.event_quota : positiveOrNull(input.policy.event_quota, 'event_quota') ?? null,
      behavior_capture: input.behavior_capture ?? current.behavior_capture,
      session_replay: input.session_replay ?? current.session_replay,
      performance_capture: input.performance_capture ?? current.performance_capture,
      policy_version: current.policy_version + 1,
    }
    validateBehaviorCapturePolicy(next.behavior_capture)
    validateCapturePolicy(next.session_replay, 'session_replay')
    validateCapturePolicy(next.performance_capture, 'performance_capture')
    await this.assertRetentionLimit(scope.tenantId, next.retention_days, next.data_lifecycle_policy)
    await this.store.updateProject(next)
    return projectDto(next, defaults)
  }

  private async assertRetentionLimit(tenantId: string, retentionDays: number | null, lifecycle: ProjectRecord['data_lifecycle_policy']): Promise<void> {
    const maximum = await this.store.activeRetentionDaysMax(tenantId)
    const lifecycleAllowed = lifecycle === null || maximum === null || (Number.isSafeInteger(maximum) && maximum > 0 && Object.values(lifecycle as DataLifecyclePolicy).every(days => days <= maximum))
    if ((retentionDays !== null && maximum !== null && retentionDays > maximum) || !lifecycleAllowed) {
      throw httpError(400, 'retention_limit_exceeded', 'Retention exceeds the active plan limit')
    }
  }

  async listKeys(scope: TenantProjectScope, projectId: string): Promise<ProjectKeyDto[]> {
    requireManager(scope)
    if (!await this.store.getProject(scope.tenantId, projectId)) throw httpError(404, 'project_not_found', 'Project was not found')
    return (await this.store.listKeys(scope.tenantId, projectId)).map(projectKeyDto)
  }

  async createKey(scope: TenantProjectScope, projectId: string, input: { label: string; key_type?: ProjectKeyRecord['key_type'] }): Promise<CreatedProjectKey> {
    requireManager(scope)
    if (!await this.store.getProject(scope.tenantId, projectId)) throw httpError(404, 'project_not_found', 'Project was not found')
    const keyType = input.key_type ?? 'browser'
    if (!PROJECT_KEY_TYPES.includes(keyType)) throw httpError(400, 'invalid_key_type', 'Unsupported project key type')
    const generated = createProjectKeySecret(keyType)
    const record: ProjectKeyRecord = {
      id: randomUUID(), tenant_id: scope.tenantId, project_id: projectId,
      key_type: keyType, label: requiredText(input.label, 'label', 200), prefix: generated.prefix,
      key_hash: hashProjectKey(generated.secret), created_at: new Date(), disabled_at: null,
    }
    await this.store.createKey(record)
    return { key: projectKeyDto(record), secret: generated.secret }
  }

  async disableKey(scope: TenantProjectScope, projectId: string, keyId: string): Promise<ProjectKeyDto> {
    requireManager(scope)
    const disabled = await this.store.disableKey(scope.tenantId, projectId, keyId, new Date())
    if (!disabled) throw httpError(404, 'key_not_found', 'Project key was not found')
    return projectKeyDto(disabled)
  }

  async rotateKey(scope: TenantProjectScope, projectId: string, keyId: string, input: { label?: string }): Promise<CreatedProjectKey> {
    requireManager(scope)
    const previous = await this.store.getKey(scope.tenantId, projectId, keyId)
    if (!previous) throw httpError(404, 'key_not_found', 'Project key was not found')
    if (previous.disabled_at) throw httpError(409, 'key_already_rotated', 'Project key is already disabled')
    await this.disableKey(scope, projectId, keyId)
    return this.createKey(scope, projectId, { label: input.label ?? previous.label, key_type: previous.key_type })
  }
}

/** Egg adapter; infrastructure installs a tenant-scoped store before HTTP routes are enabled. */
export default class ProjectsService extends Service {
  get domain(): ProjectsDomainService {
    const store = (this.app as { projectStore?: ProjectStore }).projectStore
    if (!store) throw httpError(503, 'project_store_unavailable', 'Project storage is unavailable')
    return new ProjectsDomainService(store)
  }
}
