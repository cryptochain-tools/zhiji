import { randomBytes } from 'node:crypto'
import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { normalizeEmail } from '../auth'
import { hashPassword } from '../auth/password'
import { DataLifecyclePolicy, parseDataLifecyclePolicy } from '../lifecycle/policy'
import { MembershipRole } from '../database/types'
import { can, canAssignRole, TenantAction } from './policy'
import { MembershipRecord, TenantContext, TenantDefaults, TenancyRepository } from './types'

export class TenancyFacade {
  constructor(private readonly repository: TenancyRepository) {}

  async context(tenantId: unknown, userId: string, lock = false): Promise<TenantContext> {
    if (!isUuid(tenantId)) throw httpError(404, 'tenant_not_found', 'Tenant not found')
    const membership = lock
      ? await this.repository.findMembershipForUpdate(tenantId, userId)
      : await this.repository.findMembership(tenantId, userId)
    if (!membership) throw httpError(403, 'tenant_access_denied', 'Tenant access is denied')
    return membership
  }

  require(context: TenantContext, action: TenantAction): void {
    if (!can(context.role, action)) throw httpError(403, 'tenant_action_denied', 'Tenant action is denied')
  }

  async requireProject(context: TenantContext, projectId: unknown): Promise<void> {
    if (!isUuid(projectId) || !await this.repository.hasProjectAccess(context.tenantId, context.userId, projectId)) {
      throw httpError(404, 'project_not_found', 'Project was not found')
    }
  }

  async members(context: TenantContext) {
    this.require(context, 'manage_project_access')
    return this.repository.listMembers(context.tenantId)
  }

  async updateMemberProjects(context: TenantContext, targetUserId: unknown, projectIdsValue: unknown, requestId?: string) {
    this.require(context, 'manage_project_access')
    if (!isUuid(targetUserId) || !Array.isArray(projectIdsValue) || projectIdsValue.length > 1000 || projectIdsValue.some(value => !isUuid(value))) {
      throw httpError(400, 'invalid_project_access', 'Project access is invalid')
    }
    const projectIds = [ ...new Set(projectIdsValue as string[]) ]
    const updated = await this.repository.replaceProjectAccess({ tenantId: context.tenantId, actorUserId: context.userId, targetUserId, projectIds, requestId })
    if (!updated) throw httpError(409, 'project_access_conflict', 'Project access could not be updated')
    return { userId: targetUserId, projectIds }
  }

  async addMember(context: TenantContext, input: { email: unknown; role: unknown }): Promise<MembershipRecord> {
    this.require(context, 'manage_members')
    const email = normalizeEmail(input.email)
    const role = parseRole(input.role)
    if (!email || !role) throw httpError(400, 'invalid_membership', 'Membership is invalid')
    if (!canAssignRole(context.role, role)) throw httpError(403, 'tenant_action_denied', 'Tenant action is denied')
    const userId = await this.repository.findUserIdByEmail(email)
    if (!userId) throw httpError(400, 'member_not_registered', 'Member is not registered')
    try { return await this.repository.insertMembership({ tenantId: context.tenantId, userId, role }) }
    catch { throw httpError(409, 'membership_conflict', 'Membership already exists') }
  }

  async createMemberAccount(context: TenantContext, input: { email: unknown; displayName: unknown; role: unknown; requestId?: string }): Promise<{ member: import('./types').MemberAccountRecord; existingUser: boolean; initialPassword?: string }> {
    this.require(context, 'manage_members')
    const email = normalizeEmail(input.email)
    const displayName = normalizeDisplayName(input.displayName)
    const role = parseRole(input.role)
    if (!email || !displayName || !role || role === 'owner') throw httpError(400, 'invalid_member_account', 'Member account is invalid')
    if (!canAssignRole(context.role, role)) throw httpError(403, 'tenant_action_denied', 'Tenant action is denied')
    const initialPassword = randomBytes(24).toString('base64url')
    const result = await this.repository.createMemberAccount({
      tenantId: context.tenantId, actorUserId: context.userId, email, displayName, passwordHash: await hashPassword(initialPassword), role, requestId: input.requestId,
    })
    if (!result.member) throw httpError(409, 'membership_conflict', 'Membership already exists')
    return result.existingUser ? { member: result.member, existingUser: true } : { member: result.member, existingUser: false, initialPassword }
  }

  async changeMember(context: TenantContext, targetUserId: unknown, roleValue: unknown): Promise<MembershipRecord> {
    this.require(context, 'manage_members')
    if (!isUuid(targetUserId)) throw httpError(409, 'membership_conflict', 'Membership conflict')
    const role = parseRole(roleValue)
    if (!role || !canAssignRole(context.role, role) || targetUserId === context.userId) {
      throw httpError(409, 'membership_conflict', 'Membership conflict')
    }
    const target = await this.repository.findMembershipForUpdate(context.tenantId, targetUserId)
    if (!target || target.role === 'owner' || (context.role !== 'owner' && target.role === 'admin')) {
      throw httpError(409, 'membership_conflict', 'Membership conflict')
    }
    const changed = await this.repository.updateMembershipRole({ tenantId: context.tenantId, userId: targetUserId, role })
    if (!changed) throw httpError(409, 'membership_conflict', 'Membership conflict')
    return changed
  }

  async removeMember(context: TenantContext, targetUserId: unknown): Promise<void> {
    this.require(context, 'manage_members')
    if (!isUuid(targetUserId) || targetUserId === context.userId) throw httpError(409, 'membership_conflict', 'Membership conflict')
    const target = await this.repository.findMembershipForUpdate(context.tenantId, targetUserId)
    if (!target || target.role === 'owner' || (context.role !== 'owner' && target.role === 'admin')) {
      throw httpError(409, 'membership_conflict', 'Membership conflict')
    }
    if (!await this.repository.deleteMembership(context.tenantId, targetUserId)) throw httpError(409, 'membership_conflict', 'Membership conflict')
  }

  async updateDefaults(context: TenantContext, actorUserId: string, input: { retentionDays: unknown; dataLifecyclePolicy?: unknown; eventQuota: unknown; requestId?: string }): Promise<TenantDefaults> {
    this.require(context, 'manage_projects')
    const retentionDays = optionalPositive(input.retentionDays); const dataLifecyclePolicy = input.dataLifecyclePolicy === undefined ? undefined : parseDataLifecyclePolicy(input.dataLifecyclePolicy); const eventQuota = optionalPositive(input.eventQuota)
    if (input.retentionDays !== undefined && retentionDays === undefined || input.dataLifecyclePolicy !== undefined && !dataLifecyclePolicy || input.eventQuota !== undefined && eventQuota === undefined || retentionDays === undefined && dataLifecyclePolicy === undefined && eventQuota === undefined) throw httpError(400, 'invalid_tenant_defaults', 'Tenant defaults are invalid')
    const retentionDaysMax = await this.repository.activeRetentionDaysMax(context.tenantId)
    if ((retentionDays !== undefined && retentionDaysMax !== null && retentionDays > retentionDaysMax)
      || (dataLifecyclePolicy !== undefined && (dataLifecyclePolicy === null || !withinRetentionLimit(dataLifecyclePolicy, retentionDaysMax)))) {
      throw httpError(400, 'retention_limit_exceeded', 'Retention exceeds the active plan limit')
    }
    const updated = await this.repository.updateDefaults({ tenantId: context.tenantId, actorUserId, ...(retentionDays !== undefined && { retentionDays }), ...(dataLifecyclePolicy !== undefined && dataLifecyclePolicy !== null && { dataLifecyclePolicy }), ...(eventQuota !== undefined && { eventQuota }), requestId: input.requestId })
    if (!updated) throw httpError(404, 'tenant_not_found', 'Tenant not found')
    return updated
  }

  async defaults(context: TenantContext): Promise<TenantDefaults> {
    this.require(context, 'manage_projects')
    const defaults = await this.repository.readDefaults(context.tenantId)
    if (!defaults) throw httpError(404, 'tenant_not_found', 'Tenant not found')
    return defaults
  }
}

export function parseRole(value: unknown): MembershipRole | null {
  return value === 'owner' || value === 'admin' || value === 'member' || value === 'viewer' ? value : null
}
function optionalPositive(value: unknown): number | undefined { if (value === undefined) return undefined; return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 10_000_000 ? value : undefined }
function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const displayName = value.trim()
  return displayName.length >= 1 && displayName.length <= 200 ? displayName : null
}
function withinRetentionLimit(policy: DataLifecyclePolicy, maximum: number | null): boolean {
  return maximum === null || (Number.isSafeInteger(maximum) && maximum > 0 && Object.values(policy).every(days => days <= maximum))
}
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
export function tenancyRepositoryFromApp(app: unknown): TenancyRepository | null {
  return (app as { tenancyRepository?: TenancyRepository }).tenancyRepository ?? null
}

export default class TenancyService extends Service {
  private facade(): TenancyFacade {
    const repository = tenancyRepositoryFromApp(this.app)
    if (!repository) throw httpError(503, 'tenancy_unavailable', 'Tenant authorization is unavailable')
    return new TenancyFacade(repository)
  }
  context(tenantId: unknown, userId: string, lock = false) { return this.facade().context(tenantId, userId, lock) }
  require(context: TenantContext, action: TenantAction) { return this.facade().require(context, action) }
  requireProject(context: TenantContext, projectId: unknown) { return this.facade().requireProject(context, projectId) }
  members(context: TenantContext) { return this.facade().members(context) }
  updateMemberProjects(context: TenantContext, targetUserId: unknown, projectIds: unknown, requestId?: string) { return this.facade().updateMemberProjects(context, targetUserId, projectIds, requestId) }
  addMember(context: TenantContext, input: { email: unknown; role: unknown }) { return this.facade().addMember(context, input) }
  createMemberAccount(context: TenantContext, input: { email: unknown; displayName: unknown; role: unknown; requestId?: string }) { return this.facade().createMemberAccount(context, input) }
  changeMember(context: TenantContext, targetUserId: unknown, role: unknown) { return this.facade().changeMember(context, targetUserId, role) }
  removeMember(context: TenantContext, targetUserId: unknown) { return this.facade().removeMember(context, targetUserId) }
  defaults(context: TenantContext) { return this.facade().defaults(context) }
  updateDefaults(context: TenantContext, actorUserId: string, input: { retentionDays: unknown; dataLifecyclePolicy?: unknown; eventQuota: unknown; requestId?: string }) { return this.facade().updateDefaults(context, actorUserId, input) }
}
