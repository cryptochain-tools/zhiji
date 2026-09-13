import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import type { MemberAccessRecord } from '../service/tenancy/types'

export default class TenantsController extends Controller {
  async members() {
    const items = await this.ctx.service.tenancy.index.members(await this.tenantContext(false))
    success(this.ctx, { items: items.map((item: MemberAccessRecord) => ({ user_id: item.userId, email: item.email, display_name: item.displayName, role: item.role, all_projects: item.role === 'owner', project_ids: item.projectIds })) })
  }
  async updateMemberProjects() {
    const context = await this.tenantContext(true); const body = objectBody(this.ctx.request.body)
    const result = await this.ctx.service.tenancy.index.updateMemberProjects(context, this.ctx.params.userId, body.project_ids, this.ctx.state.requestId)
    success(this.ctx, { user_id: result.userId, project_ids: result.projectIds })
  }
  async defaults() {
    const tenant = await this.ctx.service.tenancy.index.defaults(await this.tenantContext(false))
    success(this.ctx, { tenant: tenantDto(tenant) })
  }
  async addMember() {
    const context = await this.tenantContext(true)
    const body = objectBody(this.ctx.request.body)
    success(this.ctx, await this.ctx.service.tenancy.index.addMember(context, { email: body.email, role: body.role }), 201)
  }
  async createMemberAccount() {
    const context = await this.tenantContext(true)
    const body = objectBody(this.ctx.request.body)
    const result = await this.ctx.service.tenancy.index.createMemberAccount(context, { email: body.email, displayName: body.display_name, role: body.role, requestId: this.ctx.state.requestId })
    success(this.ctx, { member: { user_id: result.member.userId, email: result.member.email, display_name: result.member.displayName, role: result.member.role }, existing_user: result.existingUser, ...(result.initialPassword ? { initial_password: result.initialPassword } : {}) }, 201)
  }
  async updateMember() {
    const context = await this.tenantContext(true)
    const body = objectBody(this.ctx.request.body)
    success(this.ctx, await this.ctx.service.tenancy.index.changeMember(context, this.ctx.params.userId, body.role))
  }
  async removeMember() {
    const context = await this.tenantContext(true)
    await this.ctx.service.tenancy.index.removeMember(context, this.ctx.params.userId)
    success(this.ctx, { removed: true })
  }
  async updateDefaults() {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const context = await this.tenantContext(true); const body = objectBody(this.ctx.request.body)
    const tenant = await this.ctx.service.tenancy.index.updateDefaults(context, principal.userId, { retentionDays: body.retention_days, dataLifecyclePolicy: body.data_lifecycle_policy, eventQuota: body.event_quota, requestId: this.ctx.state.requestId })
    success(this.ctx, { tenant: tenantDto(tenant) })
  }

  private async tenantContext(lock: boolean) {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    return this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId, lock)
  }
}

function tenantDto(tenant: { id: string; retentionDays: number; dataLifecyclePolicy: unknown; eventQuota: number }) {
  return { id: tenant.id, retention_days: tenant.retentionDays, data_lifecycle_policy: tenant.dataLifecyclePolicy, event_quota: tenant.eventQuota }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'invalid_request', 'Request body must be an object')
  return value as Record<string, unknown>
}
