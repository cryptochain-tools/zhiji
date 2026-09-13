import { httpError } from '../../lib/http'
import { DatabasePool } from '../database/types'

export interface BusinessUserProfileInput {
  businessUserId: string
  email: string
  displayName?: string
  department?: string
  role?: string
  isActive: boolean
  updatedAt?: Date
}

export interface BusinessUserDirectoryRequest {
  key: string
  profiles: BusinessUserProfileInput[]
}

export function parseBusinessUserDirectoryRequest(value: unknown): BusinessUserDirectoryRequest {
  if (!isPlainObject(value)) invalid('Request body must be an object')
  const body = value as Record<string, unknown>
  if (Object.keys(body).some(key => !new Set([ 'key', 'profiles' ]).has(key))) invalid('Request body contains unsupported fields')
  if (typeof body.key !== 'string' || !body.key.trim()) invalid('key must be a non-empty string')
  if (!Array.isArray(body.profiles) || body.profiles.length < 1 || body.profiles.length > 100) invalid('profiles must contain 1 to 100 entries')
  return { key: body.key, profiles: body.profiles.map(parseProfile) }
}

export class PostgreSqlBusinessUserDirectory {
  constructor(private readonly database: DatabasePool) {}

  async upsert(scope: { tenantId: string; projectId: string }, profiles: readonly BusinessUserProfileInput[]): Promise<number> {
    return this.database.transaction(async transaction => {
      let accepted = 0
      for (const profile of profiles) {
        const result = await transaction.query(
          `INSERT INTO business_user_profiles
            (tenant_id, project_id, business_user_id, email_normalized, display_name, department, role, is_active, source_updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()))
           ON CONFLICT (tenant_id, project_id, business_user_id) DO UPDATE SET
             email_normalized = EXCLUDED.email_normalized,
             display_name = EXCLUDED.display_name,
             department = EXCLUDED.department,
             role = EXCLUDED.role,
             is_active = EXCLUDED.is_active,
             source_updated_at = EXCLUDED.source_updated_at,
             updated_at = now()
           WHERE business_user_profiles.source_updated_at IS NULL
              OR business_user_profiles.source_updated_at <= EXCLUDED.source_updated_at
           RETURNING business_user_id`,
          [ scope.tenantId, scope.projectId, profile.businessUserId, profile.email, profile.displayName ?? null, profile.department ?? null, profile.role ?? null, profile.isActive, profile.updatedAt ?? null ],
        )
        accepted += result.rowCount ?? 0
      }
      return accepted
    })
  }
}

function parseProfile(value: unknown): BusinessUserProfileInput {
  if (!isPlainObject(value)) invalid('Each profile must be an object')
  const profile = value as Record<string, unknown>
  const allowed = new Set([ 'business_user_id', 'email', 'display_name', 'department', 'role', 'is_active', 'updated_at' ])
  if (Object.keys(profile).some(key => !allowed.has(key))) invalid('Profile contains unsupported fields')
  const businessUserId = bounded(profile.business_user_id, 'business_user_id', 128)
  const email = bounded(profile.email, 'email', 320).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid('email must be a valid address')
  const updatedAt = optionalDate(profile.updated_at)
  return {
    businessUserId,
    email,
    ...(optionalBounded(profile.display_name, 'display_name', 200) ? { displayName: optionalBounded(profile.display_name, 'display_name', 200) } : {}),
    ...(optionalBounded(profile.department, 'department', 200) ? { department: optionalBounded(profile.department, 'department', 200) } : {}),
    ...(optionalBounded(profile.role, 'role', 100) ? { role: optionalBounded(profile.role, 'role', 100) } : {}),
    isActive: profile.is_active === undefined ? true : boolean(profile.is_active, 'is_active'),
    ...(updatedAt ? { updatedAt } : {}),
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function bounded(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > max) invalid(`${field} must be a trimmed string of at most ${max} characters`)
  return value as string
}

function optionalBounded(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined
  return bounded(value, field, max)
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') invalid(`${field} must be a boolean`)
  return value as boolean
}

function optionalDate(value: unknown): Date | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') invalid('updated_at must be an ISO timestamp')
  const parsed = new Date(value as string)
  if (!Number.isFinite(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(value as string)) invalid('updated_at must be an ISO timestamp')
  return parsed
}

function invalid(message: string): never {
  throw httpError(400, 'invalid_business_user_profiles', message)
}
