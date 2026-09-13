import { DatabaseClient } from '../database/types'
import { ProjectKeyRecord, ProjectRecord, ProjectStore, TenantDefaults } from './types'

/** PostgreSQL adapter for the project and project-key management boundary. */
export class PostgresProjectStore implements ProjectStore {
  constructor(private readonly database: DatabaseClient) {}

  async getTenantDefaults(tenantId: string): Promise<TenantDefaults | null> {
    const result = await this.database.query<TenantDefaults>(
      'SELECT retention_days, data_lifecycle_policy, event_quota FROM tenants WHERE id = $1', [ tenantId ],
    )
    return result.rows[0] ?? null
  }

  async activeRetentionDaysMax(tenantId: string): Promise<number | null> {
    const result = await this.database.query<{ retention_days_max: number }>(
      `SELECT plans.retention_days_max
       FROM subscriptions JOIN plans ON plans.id = subscriptions.plan_id
       WHERE subscriptions.tenant_id = $1 AND subscriptions.status = 'active'
         AND subscriptions.cycle_started_at <= now() AND subscriptions.cycle_ends_at > now()
       ORDER BY subscriptions.cycle_ends_at DESC LIMIT 1`, [ tenantId ],
    )
    const value = result.rows[0]?.retention_days_max
    return value === undefined ? null : Number(value)
  }

  async getProject(tenantId: string, projectId: string): Promise<ProjectRecord | null> {
    const result = await this.database.query<ProjectRow>(`${projectSelect} WHERE tenant_id = $1 AND id = $2`, [ tenantId, projectId ])
    return result.rows[0] ? projectRecord(result.rows[0]) : null
  }

  async listProjects(tenantId: string, userId: string, includeAll: boolean): Promise<ProjectRecord[]> {
    const result = await this.database.query<ProjectRow>(
      `${projectSelect} WHERE tenant_id = $1 AND ($3 OR EXISTS (
        SELECT 1 FROM project_memberships WHERE project_memberships.tenant_id = projects.tenant_id
          AND project_memberships.project_id = projects.id AND project_memberships.user_id = $2
      )) ORDER BY created_at DESC, id DESC`, [ tenantId, userId, includeAll ],
    )
    return result.rows.map(projectRecord)
  }

  async createProject(record: ProjectRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO projects
       (id, tenant_id, name, allowed_origins, core_event_names, page_capture, mobile_applications, retention_days, data_lifecycle_policy, event_quota, behavior_capture, session_replay, performance_capture, policy_version, created_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15)`,
      [ record.id, record.tenant_id, record.name, JSON.stringify(record.allowed_origins), JSON.stringify(record.core_event_names),
        JSON.stringify(record.page_capture), JSON.stringify(record.mobile_applications), record.retention_days, record.data_lifecycle_policy === null ? null : JSON.stringify(record.data_lifecycle_policy), record.event_quota, JSON.stringify(record.behavior_capture), JSON.stringify(record.session_replay),
        JSON.stringify(record.performance_capture), record.policy_version, record.created_at ],
    )
  }

  async updateProject(record: ProjectRecord): Promise<void> {
    const result = await this.database.query(
      `UPDATE projects SET name = $3, allowed_origins = $4::jsonb, core_event_names = $5::jsonb, page_capture = $6::jsonb,
        mobile_applications = $7::jsonb, retention_days = $8, data_lifecycle_policy = $9::jsonb, event_quota = $10, behavior_capture = $11::jsonb, session_replay = $12::jsonb,
        performance_capture = $13::jsonb, policy_version = $14, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [ record.tenant_id, record.id, record.name, JSON.stringify(record.allowed_origins), JSON.stringify(record.core_event_names),
        JSON.stringify(record.page_capture), JSON.stringify(record.mobile_applications), record.retention_days, record.data_lifecycle_policy === null ? null : JSON.stringify(record.data_lifecycle_policy), record.event_quota, JSON.stringify(record.behavior_capture), JSON.stringify(record.session_replay),
        JSON.stringify(record.performance_capture), record.policy_version ],
    )
    if (result.rowCount !== 1) throw new Error('project disappeared during update')
  }

  async listKeys(tenantId: string, projectId: string): Promise<ProjectKeyRecord[]> {
    const result = await this.database.query<ProjectKeyRecord>(`${keySelect} WHERE tenant_id = $1 AND project_id = $2 ORDER BY created_at DESC, id DESC`, [ tenantId, projectId ])
    return result.rows
  }

  async getKey(tenantId: string, projectId: string, keyId: string): Promise<ProjectKeyRecord | null> {
    const result = await this.database.query<ProjectKeyRecord>(`${keySelect} WHERE tenant_id = $1 AND project_id = $2 AND id = $3`, [ tenantId, projectId, keyId ])
    return result.rows[0] ?? null
  }

  async createKey(record: ProjectKeyRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO project_keys (id, tenant_id, project_id, key_type, label, prefix, key_hash, created_at, disabled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ record.id, record.tenant_id, record.project_id, record.key_type, record.label, record.prefix, record.key_hash, record.created_at, record.disabled_at ],
    )
  }

  async disableKey(tenantId: string, projectId: string, keyId: string, disabledAt: Date): Promise<ProjectKeyRecord | null> {
    const result = await this.database.query<ProjectKeyRecord>(
      `UPDATE project_keys SET disabled_at = $4
       WHERE tenant_id = $1 AND project_id = $2 AND id = $3 AND disabled_at IS NULL
       RETURNING id, tenant_id, project_id, key_type, label, prefix, key_hash, created_at, disabled_at`,
      [ tenantId, projectId, keyId, disabledAt ],
    )
    return result.rows[0] ?? null
  }
}

interface ProjectRow extends Omit<ProjectRecord, 'allowed_origins' | 'core_event_names' | 'page_capture' | 'mobile_applications' | 'behavior_capture' | 'session_replay' | 'performance_capture'> {
  allowed_origins: unknown
  core_event_names: unknown
  page_capture: unknown
  mobile_applications: unknown
  behavior_capture: unknown
  session_replay: unknown
  performance_capture: unknown
}

const projectSelect = `SELECT id, tenant_id, name, allowed_origins, core_event_names, page_capture, mobile_applications, retention_days, data_lifecycle_policy, event_quota,
  behavior_capture, session_replay, performance_capture, policy_version, created_at FROM projects`
const keySelect = 'SELECT id, tenant_id, project_id, key_type, label, prefix, key_hash, created_at, disabled_at FROM project_keys'

function projectRecord(row: ProjectRow): ProjectRecord {
  return {
    ...row,
    allowed_origins: stringArray(row.allowed_origins),
    core_event_names: stringArray(row.core_event_names),
    page_capture: pageCapture(row.page_capture),
    mobile_applications: mobileApplications(row.mobile_applications),
    data_lifecycle_policy: dataLifecyclePolicy(row.data_lifecycle_policy),
    behavior_capture: behaviorCapture(row.behavior_capture),
    session_replay: objectValue(row.session_replay),
    performance_capture: objectValue(row.performance_capture),
  }
}
function dataLifecyclePolicy(value: unknown): ProjectRecord['data_lifecycle_policy'] {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_project_data_lifecycle_policy')
  const item = value as Record<string, unknown>
  const keys = [ 'raw_event_days', 'error_occurrence_days', 'behavior_raw_days', 'replay_raw_days', 'performance_raw_days', 'aggregate_days', 'backup_expiry_days' ]
  if (!keys.every(key => Number.isSafeInteger(item[key]) && (item[key] as number) > 0)) throw new Error('invalid_project_data_lifecycle_policy')
  return Object.fromEntries(keys.map(key => [key, item[key]])) as ProjectRecord['data_lifecycle_policy']
}
function mobileApplications(value: unknown): ProjectRecord['mobile_applications'] {
  if (!Array.isArray(value)) return []
  return value.filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(item => {
    const record = item as Record<string, unknown>
    return typeof record.platform === 'string' && typeof record.application_id === 'string' && typeof record.min_version === 'string'
      ? { platform: record.platform as ProjectRecord['mobile_applications'][number]['platform'], application_id: record.application_id, min_version: record.min_version, ...(typeof record.max_version === 'string' ? { max_version: record.max_version } : {}) }
      : null
  }).filter((item): item is ProjectRecord['mobile_applications'][number] => item !== null)
}
function pageCapture(value: unknown): ProjectRecord['page_capture'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { allowed_page_keys: [], route_templates: [] }
  const item = value as Record<string, unknown>
  return { allowed_page_keys: stringArray(item.allowed_page_keys), route_templates: stringArray(item.route_templates) }
}
function stringArray(value: unknown): string[] { return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : [] }
function behaviorCapture(value: unknown): ProjectRecord['behavior_capture'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { enabled: false, policy_version: 1, page_allowlist: [], track_ids: [], block_selectors: [], sample_rate: 0 }
  const item = value as Record<string, unknown>
  return {
    enabled: item.enabled === true,
    policy_version: typeof item.policy_version === 'number' && Number.isSafeInteger(item.policy_version) && item.policy_version > 0 ? item.policy_version : 1,
    page_allowlist: stringArray(item.page_allowlist), track_ids: stringArray(item.track_ids), block_selectors: stringArray(item.block_selectors),
    sample_rate: typeof item.sample_rate === 'number' && Number.isFinite(item.sample_rate) && item.sample_rate >= 0 && item.sample_rate <= 1 ? item.sample_rate : 0,
  }
}
function objectValue(value: unknown): { enabled: boolean; policy_version: number } & Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as { enabled: boolean; policy_version: number } & Record<string, unknown> : { enabled: false, policy_version: 1 }
}
