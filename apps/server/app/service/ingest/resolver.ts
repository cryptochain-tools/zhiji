import { createHash } from 'node:crypto'
import { DatabaseClient } from '../database/types'
import { IngestProject } from './transport'

interface BrowserProjectRow {
  project_key_id: string
  tenant_id: string
  project_id: string
  allowed_origins: unknown
  page_capture: unknown
  behavior_capture: unknown
  session_replay: unknown
  performance_capture: unknown
}

interface ServerProjectRow {
  project_key_id: string
  tenant_id: string
  project_id: string
  page_capture: unknown
}

interface MobileProjectRow extends ServerProjectRow {
  mobile_applications: unknown
}

/** The minimum trusted scope needed by a server-side telemetry request. */
export interface ServerIngestProject {
  tenantId: string
  projectId: string
  projectKeyId: string
  pagePolicy: IngestProject['pagePolicy']
}

export interface MobileApplicationRegistration {
  platform: 'ios' | 'android' | 'react_native'
  applicationId: string
  minVersion: string
  maxVersion?: string
}

export interface MobileIngestProject extends ServerIngestProject {
  applications: readonly MobileApplicationRegistration[]
}

/**
 * Resolves only active browser keys.  It intentionally returns null for every
 * malformed policy so a partially migrated or invalid project never accepts
 * browser traffic.
 */
export class BrowserProjectKeyResolver {
  constructor(private readonly database: DatabaseClient) {}

  async resolve(key: string): Promise<IngestProject | null> {
    if (key.length < 8 || key.length > 512) return null
    const keyHash = createHash('sha256').update(key, 'utf8').digest()
    const result = await this.database.query<BrowserProjectRow>(
      `SELECT keys.id AS project_key_id, keys.tenant_id, keys.project_id, projects.allowed_origins, projects.page_capture,
              projects.behavior_capture, projects.session_replay, projects.performance_capture
       FROM project_keys AS keys
       INNER JOIN projects ON projects.tenant_id = keys.tenant_id AND projects.id = keys.project_id
       WHERE keys.key_hash = $1 AND keys.key_type = 'browser' AND keys.disabled_at IS NULL
         AND projects.deletion_status = 'active'
       LIMIT 1`,
      [ keyHash ],
    )
    const row = result.rows[0]
    if (!row) return null
    const allowedOrigins = stringArray(row.allowed_origins, 100, isOrigin)
    const pageCapture = pagePolicy(row.page_capture)
    const capture = capturePolicy(row)
    if (!allowedOrigins || !pageCapture || !capture) return null
    if (!isId(row.project_key_id)) return null
    return { tenantId: row.tenant_id, projectId: row.project_id, projectKeyId: row.project_key_id, allowedOrigins, pagePolicy: pageCapture, capture }
  }
}

/**
 * Resolves only active server keys. Server SDK requests deliberately have no
 * browser Origin: accepting an Origin here would make a leaked server key
 * usable from a web page. The transport enforces that boundary before it
 * validates or writes a payload.
 */
export class ServerProjectKeyResolver {
  constructor(private readonly database: DatabaseClient) {}

  async resolve(key: string): Promise<ServerIngestProject | null> {
    if (key.length < 8 || key.length > 512) return null
    const keyHash = createHash('sha256').update(key, 'utf8').digest()
    const result = await this.database.query<ServerProjectRow>(
      `SELECT keys.id AS project_key_id, keys.tenant_id, keys.project_id, projects.page_capture
       FROM project_keys AS keys
       INNER JOIN projects ON projects.tenant_id = keys.tenant_id AND projects.id = keys.project_id
       WHERE keys.key_hash = $1 AND keys.key_type = 'server' AND keys.disabled_at IS NULL
         AND projects.deletion_status = 'active'
       LIMIT 1`,
      [ keyHash ],
    )
    const row = result.rows[0]
    if (!row) return null
    const policy = pagePolicy(row.page_capture)
    return policy && isId(row.project_key_id) ? { tenantId: row.tenant_id, projectId: row.project_id, projectKeyId: row.project_key_id, pagePolicy: policy } : null
  }
}

/** OTLP credentials are a distinct key class and cannot be used on the Node
 * or browser ingest routes.  OTLP's protocol carries no browser Origin. */
export class OtlpProjectKeyResolver {
  constructor(private readonly database: DatabaseClient) {}

  async resolve(key: string): Promise<ServerIngestProject | null> {
    if (key.length < 8 || key.length > 512) return null
    const keyHash = createHash('sha256').update(key, 'utf8').digest()
    const result = await this.database.query<ServerProjectRow>(
      `SELECT keys.id AS project_key_id, keys.tenant_id, keys.project_id, projects.page_capture
       FROM project_keys AS keys
       INNER JOIN projects ON projects.tenant_id = keys.tenant_id AND projects.id = keys.project_id
       WHERE keys.key_hash = $1 AND keys.key_type = 'otel' AND keys.disabled_at IS NULL
         AND projects.deletion_status = 'active'
       LIMIT 1`,
      [ keyHash ],
    )
    const row = result.rows[0]
    if (!row) return null
    const policy = pagePolicy(row.page_capture)
    return policy && isId(row.project_key_id)
      ? { tenantId: row.tenant_id, projectId: row.project_id, projectKeyId: row.project_key_id, pagePolicy: policy }
      : null
  }
}

/** Resolves only active mobile keys and registered app declarations. */
export class MobileProjectKeyResolver {
  constructor(private readonly database: DatabaseClient) {}

  async resolve(key: string): Promise<MobileIngestProject | null> {
    if (key.length < 8 || key.length > 512) return null
    const keyHash = createHash('sha256').update(key, 'utf8').digest()
    const result = await this.database.query<MobileProjectRow>(
      `SELECT keys.id AS project_key_id, keys.tenant_id, keys.project_id, projects.page_capture, projects.mobile_applications
       FROM project_keys AS keys
       INNER JOIN projects ON projects.tenant_id = keys.tenant_id AND projects.id = keys.project_id
       WHERE keys.key_hash = $1 AND keys.key_type = 'mobile' AND keys.disabled_at IS NULL
         AND projects.deletion_status = 'active'
       LIMIT 1`,
      [ keyHash ],
    )
    const row = result.rows[0]
    if (!row) return null
    const policy = pagePolicy(row.page_capture)
    const applications = mobileApplications(row.mobile_applications)
    return policy && applications && isId(row.project_key_id)
      ? { tenantId: row.tenant_id, projectId: row.project_id, projectKeyId: row.project_key_id, pagePolicy: policy, applications }
      : null
  }
}

function capturePolicy(row: BrowserProjectRow): IngestProject['capture'] | null {
  const enabled = (value: unknown): boolean | null => {
    if (!plainObject(value) || typeof value.enabled !== 'boolean') return null
    const version = value.policy_version
    if (!Number.isSafeInteger(version) || typeof version !== 'number' || version < 1) return null
    return value.enabled
  }
  const behaviorPolicy = behaviorCapturePolicy(row.behavior_capture)
  const replay = enabled(row.session_replay)
  const performance = enabled(row.performance_capture)
  return behaviorPolicy === null || replay === null || performance === null ? null : { behavior: behaviorPolicy.enabled, replay, performance, behaviorPolicy }
}

function behaviorCapturePolicy(value: unknown): IngestProject['capture']['behaviorPolicy'] | null {
  if (!plainObject(value) || typeof value.enabled !== 'boolean' || typeof value.policy_version !== 'number' || !Number.isSafeInteger(value.policy_version) || value.policy_version < 1
    || typeof value.sample_rate !== 'number' || !Number.isFinite(value.sample_rate) || value.sample_rate < 0 || value.sample_rate > 1) return null
  const pageAllowlist = stringArray(value.page_allowlist, 500, entry => entry.startsWith('/') && entry.length <= 512 && !/[?#@]/.test(entry))
  const trackIds = stringArray(value.track_ids, 500, entry => /^[A-Za-z0-9_-]{1,128}$/.test(entry))
  const blocks = stringArray(value.block_selectors, 500, entry => entry.length >= 1 && entry.length <= 200 && !/[\n\r]/.test(entry))
  if (!pageAllowlist || !trackIds || !blocks) return null
  if (value.enabled && (pageAllowlist.length === 0 || value.sample_rate <= 0)) return null
  return { enabled: value.enabled, policyVersion: value.policy_version, pageAllowlist, trackIds, sampleRate: value.sample_rate }
}

function pagePolicy(value: unknown): IngestProject['pagePolicy'] | null {
  if (!plainObject(value)) return null
  const keys = stringArray(value.allowed_page_keys, 500, value => value.startsWith('/') && value.length <= 512)
  const templates = stringArray(value.route_templates, 500, value => value.startsWith('/') && value.length <= 512)
  return keys && templates ? { allowedPageKeys: keys, routeTemplates: templates } : null
}
function mobileApplications(value: unknown): MobileApplicationRegistration[] | null {
  if (!Array.isArray(value) || value.length > 100) return null
  const seen = new Set<string>()
  const registrations: MobileApplicationRegistration[] = []
  for (const item of value) {
    if (!plainObject(item) || !isMobilePlatform(item.platform) || !isApplicationId(item.application_id) || !isVersion(item.min_version)
      || (item.max_version !== undefined && !isVersion(item.max_version))) return null
    if (typeof item.max_version === 'string' && compareVersions(item.min_version, item.max_version) > 0) return null
    const key = `${item.platform}:${item.application_id}`
    if (seen.has(key)) return null
    seen.add(key)
    registrations.push({ platform: item.platform, applicationId: item.application_id, minVersion: item.min_version, ...(typeof item.max_version === 'string' ? { maxVersion: item.max_version } : {}) })
  }
  return registrations
}
function isMobilePlatform(value: unknown): value is MobileApplicationRegistration['platform'] { return value === 'ios' || value === 'android' || value === 'react_native' }
function isApplicationId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(value) }
function isVersion(value: unknown): value is string { return typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(value) && value.length <= 64 }
function compareVersions(left: string, right: string): number {
  const parts = (value: string) => value.split(/[+-]/, 1)[0]!.split('.').map(Number)
  const a = parts(left), b = parts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) { const delta = (a[index] ?? 0) - (b[index] ?? 0); if (delta) return delta }
  return 0
}

function stringArray(value: unknown, max: number, validate: (entry: string) => boolean): string[] | null {
  if (!Array.isArray(value) || value.length > max || !value.every(entry => typeof entry === 'string' && validate(entry))) return null
  return [ ...new Set(value) ]
}

function isOrigin(value: string): boolean {
  try { const url = new URL(value); return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value } catch { return false }
}
function isId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128 }
function plainObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
