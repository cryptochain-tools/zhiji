import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { can, canAssignRole } from '../../../../app/service/tenancy/policy'
import { TenancyFacade } from '../../../../app/service/tenancy'
import { MemberAccountCreationInput, MembershipRecord, TenantDefaults, TenancyRepository } from '../../../../app/service/tenancy/types'

const tenantId = '00000000-0000-4000-8000-000000000001'
const ownerId = '00000000-0000-4000-8000-000000000002'
const adminId = '00000000-0000-4000-8000-000000000003'
const memberId = '00000000-0000-4000-8000-000000000004'
const projectId = '00000000-0000-4000-8000-000000000010'

class Memberships implements TenancyRepository {
  retentionDaysMax: number | null = null
  defaults: TenantDefaults = { id: tenantId, retentionDays: 365, dataLifecyclePolicy: { raw_event_days: 365, error_occurrence_days: 90, behavior_raw_days: 14, replay_raw_days: 7, performance_raw_days: 30, aggregate_days: 365, backup_expiry_days: 30 }, eventQuota: 100000 }
  items = new Map<string, MembershipRecord>([[`${tenantId}:${ownerId}`, { tenantId, userId: ownerId, role: 'owner' }], [`${tenantId}:${adminId}`, { tenantId, userId: adminId, role: 'admin' }], [`${tenantId}:${memberId}`, { tenantId, userId: memberId, role: 'member' }]])
  users = new Map<string, string>([[ 'member@example.com', memberId ], [ 'existing@example.com', '00000000-0000-4000-8000-000000000005' ]])
  accountInputs: MemberAccountCreationInput[] = []
  projectAccess = new Map<string, Set<string>>()
  async findMembership(tenant: string, user: string) { return this.items.get(`${tenant}:${user}`) ?? null }
  async findMembershipForUpdate(tenant: string, user: string) { return this.findMembership(tenant, user) }
  async findUserIdByEmail(email: string) { return email === 'member@example.com' ? memberId : null }
  async insertMembership(input: MembershipRecord) { if (this.items.has(`${input.tenantId}:${input.userId}`)) throw new Error('duplicate'); this.items.set(`${input.tenantId}:${input.userId}`, input); return input }
  async createMemberAccount(input: MemberAccountCreationInput) {
    this.accountInputs.push(input)
    const existing = this.users.get(input.email)
    const userId = existing ?? '00000000-0000-4000-8000-000000000006'
    if (this.items.has(`${input.tenantId}:${userId}`)) return { member: null, existingUser: Boolean(existing) }
    if (!existing) this.users.set(input.email, userId)
    const membership = { tenantId: input.tenantId, userId, role: input.role }
    this.items.set(`${input.tenantId}:${userId}`, membership)
    return { member: { userId, email: input.email, displayName: existing ? 'Existing member' : input.displayName, role: input.role }, existingUser: Boolean(existing) }
  }
  async updateMembershipRole(input: MembershipRecord) { if (!this.items.has(`${input.tenantId}:${input.userId}`)) return null; this.items.set(`${input.tenantId}:${input.userId}`, input); return input }
  async deleteMembership(tenant: string, user: string) { return this.items.delete(`${tenant}:${user}`) }
  async listMembers(tenant: string) { return [...this.items.values()].filter(item => item.tenantId === tenant).map(item => ({ ...item, email: `${item.userId}@example.com`, displayName: item.userId, projectIds: [...(this.projectAccess.get(`${tenant}:${item.userId}`) ?? [])] })) }
  async hasProjectAccess(tenant: string, user: string, project: string) { const member = await this.findMembership(tenant, user); return member?.role === 'owner' || this.projectAccess.get(`${tenant}:${user}`)?.has(project) === true }
  async replaceProjectAccess(input: { tenantId: string; actorUserId: string; targetUserId: string; projectIds: string[] }) { const target = await this.findMembership(input.tenantId, input.targetUserId); if (!target || target.role === 'owner') return false; this.projectAccess.set(`${input.tenantId}:${input.targetUserId}`, new Set(input.projectIds)); return true }
  async activeRetentionDaysMax(tenant: string) { return tenant === tenantId ? this.retentionDaysMax : null }
  async readDefaults(tenant: string) { return tenant === tenantId ? this.defaults : null }
  async updateDefaults(input: { tenantId: string; retentionDays?: number; dataLifecyclePolicy?: TenantDefaults['dataLifecyclePolicy']; eventQuota?: number }) { if (input.tenantId !== tenantId) return null; this.defaults = { id: tenantId, retentionDays: input.retentionDays ?? this.defaults.retentionDays, dataLifecyclePolicy: input.dataLifecyclePolicy ?? this.defaults.dataLifecyclePolicy, eventQuota: input.eventQuota ?? this.defaults.eventQuota }; return this.defaults }
}

describe('tenant authorization', () => {
  it('defines the four-role matrix without granting viewer writes', () => {
    assert.equal(can('owner', 'manage_admins'), true)
    assert.equal(can('owner', 'manage_project_access'), true)
    assert.equal(can('admin', 'manage_project_access'), false)
    assert.equal(can('admin', 'manage_admins'), false)
    assert.equal(can('member', 'update_error_state'), true)
    assert.equal(can('viewer', 'update_error_state'), false)
    assert.equal(canAssignRole('admin', 'admin'), false)
    assert.equal(canAssignRole('admin', 'viewer'), true)
  })
  it('allows only owners or explicitly granted members to enter a project', async () => {
    const repository = new Memberships(); const facade = new TenancyFacade(repository)
    await facade.requireProject(await facade.context(tenantId, ownerId), projectId)
    await assert.rejects(async () => facade.requireProject(await facade.context(tenantId, adminId), projectId), { code: 'project_not_found' })
    await assert.rejects(async () => facade.requireProject(await facade.context(tenantId, memberId), projectId), { code: 'project_not_found' })
    repository.projectAccess.set(`${tenantId}:${adminId}`, new Set([projectId]))
    repository.projectAccess.set(`${tenantId}:${memberId}`, new Set([projectId]))
    await facade.requireProject(await facade.context(tenantId, adminId), projectId)
    await facade.requireProject(await facade.context(tenantId, memberId), projectId)
    await assert.rejects(async () => facade.requireProject(await facade.context(tenantId, memberId), 'not-a-uuid'), { code: 'project_not_found' })
  })
  it('does not expose project assignments through the admin member-management role', async () => {
    const facade = new TenancyFacade(new Memberships())
    await assert.rejects(async () => facade.members(await facade.context(tenantId, adminId)), { code: 'tenant_action_denied' })
    assert.equal((await facade.members(await facade.context(tenantId, ownerId))).length, 3)
  })
  it('lets only the owner replace a non-owner project set', async () => {
    const repository = new Memberships(); const facade = new TenancyFacade(repository)
    const result = await facade.updateMemberProjects(await facade.context(tenantId, ownerId), memberId, [ projectId, projectId ])
    assert.deepEqual(result.projectIds, [ projectId ])
    assert.deepEqual([...(repository.projectAccess.get(`${tenantId}:${memberId}`) ?? [])], [ projectId ])
    await assert.rejects(async () => facade.updateMemberProjects(await facade.context(tenantId, adminId), memberId, []), { code: 'tenant_action_denied' })
    await assert.rejects(async () => facade.updateMemberProjects(await facade.context(tenantId, ownerId), ownerId, []), { code: 'project_access_conflict' })
    await assert.rejects(async () => facade.updateMemberProjects(await facade.context(tenantId, ownerId), memberId, [ 'invalid' ]), { code: 'invalid_project_access' })
  })
  it('does not construct a context for a non-member tenant', async () => {
    const facade = new TenancyFacade(new Memberships())
    await assert.rejects(() => facade.context('00000000-0000-4000-8000-000000000099', ownerId), { code: 'tenant_access_denied' })
  })
  it('does not let an admin change or remove an admin', async () => {
    const facade = new TenancyFacade(new Memberships())
    const admin = await facade.context(tenantId, adminId)
    await assert.rejects(() => facade.changeMember(admin, ownerId, 'viewer'), { code: 'membership_conflict' })
    await assert.rejects(() => facade.removeMember(admin, ownerId), { code: 'membership_conflict' })
  })
  it('creates a global account only when the email is new and returns its generated password once', async () => {
    const repository = new Memberships(); const facade = new TenancyFacade(repository)
    const owner = await facade.context(tenantId, ownerId)
    const created = await facade.createMemberAccount(owner, { email: ' New@example.com ', displayName: ' New member ', role: 'admin' })
    assert.equal(created.member.role, 'admin')
    assert.equal(created.initialPassword?.length, 32)
    assert.equal(repository.accountInputs[0]?.email, 'new@example.com')
    assert.equal(repository.accountInputs[0]?.displayName, 'New member')
    assert.match(repository.accountInputs[0]?.passwordHash ?? '', /^scrypt\$/)

    const existing = await facade.createMemberAccount(owner, { email: 'existing@example.com', displayName: 'Ignored name', role: 'member' })
    assert.equal(existing.member.userId, '00000000-0000-4000-8000-000000000005')
    assert.equal(existing.member.displayName, 'Existing member')
    assert.equal(existing.existingUser, true)
    assert.equal(existing.initialPassword, undefined)
  })
  it('rejects duplicate membership and roles the actor cannot assign', async () => {
    const facade = new TenancyFacade(new Memberships())
    const owner = await facade.context(tenantId, ownerId)
    await assert.rejects(() => facade.createMemberAccount(owner, { email: 'member@example.com', displayName: 'Member', role: 'member' }), { code: 'membership_conflict' })
    const admin = await facade.context(tenantId, adminId)
    await assert.rejects(() => facade.createMemberAccount(admin, { email: 'new@example.com', displayName: 'New member', role: 'admin' }), { code: 'tenant_action_denied' })
    await assert.rejects(() => facade.createMemberAccount(owner, { email: 'owner@example.com', displayName: 'Another owner', role: 'owner' }), { code: 'invalid_member_account' })
  })
  it('lets project managers update bounded tenant defaults without accepting an empty update', async () => {
    const facade = new TenancyFacade(new Memberships()); const admin = await facade.context(tenantId, adminId)
    const updated = await facade.updateDefaults(admin, adminId, { retentionDays: 90, eventQuota: 250000 })
    assert.deepEqual(updated, { id: tenantId, retentionDays: 90, dataLifecyclePolicy: { raw_event_days: 365, error_occurrence_days: 90, behavior_raw_days: 14, replay_raw_days: 7, performance_raw_days: 30, aggregate_days: 365, backup_expiry_days: 30 }, eventQuota: 250000 })
    await assert.rejects(() => facade.updateDefaults(admin, adminId, { retentionDays: undefined, eventQuota: undefined }), { code: 'invalid_tenant_defaults' })
    await assert.rejects(() => facade.updateDefaults(admin, adminId, { retentionDays: 0, eventQuota: 1000 }), { code: 'invalid_tenant_defaults' })
  })
  it('returns tenant defaults only to project managers', async () => {
    const facade = new TenancyFacade(new Memberships())
    const admin = await facade.context(tenantId, adminId)
    assert.equal((await facade.defaults(admin)).retentionDays, 365)
    const viewer = { tenantId, userId: memberId, role: 'viewer' as const }
    await assert.rejects(() => facade.defaults(viewer), { code: 'tenant_action_denied' })
  })
  it('accepts only a complete tenant lifecycle policy', async () => {
    const facade = new TenancyFacade(new Memberships()); const admin = await facade.context(tenantId, adminId)
    const policy = { raw_event_days: 180, error_occurrence_days: 90, behavior_raw_days: 14, replay_raw_days: 7, performance_raw_days: 30, aggregate_days: 365, backup_expiry_days: 30 }
    const updated = await facade.updateDefaults(admin, adminId, { retentionDays: undefined, dataLifecyclePolicy: policy, eventQuota: undefined })
    assert.deepEqual(updated.dataLifecyclePolicy, policy)
    await assert.rejects(() => facade.updateDefaults(admin, adminId, { retentionDays: undefined, dataLifecyclePolicy: { raw_event_days: 1 }, eventQuota: undefined }), { code: 'invalid_tenant_defaults' })
  })
  it('rejects tenant defaults beyond the active plan retention cap', async () => {
    const repository = new Memberships(); repository.retentionDaysMax = 365
    const facade = new TenancyFacade(repository); const admin = await facade.context(tenantId, adminId)
    await assert.rejects(() => facade.updateDefaults(admin, adminId, { retentionDays: 366, eventQuota: undefined }), { code: 'retention_limit_exceeded' })
    await assert.rejects(() => facade.updateDefaults(admin, adminId, { retentionDays: undefined, eventQuota: undefined, dataLifecyclePolicy: { raw_event_days: 365, error_occurrence_days: 90, behavior_raw_days: 14, replay_raw_days: 7, performance_raw_days: 30, aggregate_days: 366, backup_expiry_days: 30 } }), { code: 'retention_limit_exceeded' })
  })
})
