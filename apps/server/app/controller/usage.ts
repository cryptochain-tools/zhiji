import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { isUuid } from '../service/tenancy'

/** Usage includes operational volume; viewers do not receive it. `member` is the current manager-level role. */
export default class UsageController extends Controller {
  async show() {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId, false)
    if (context.role !== 'owner' && context.role !== 'admin' && context.role !== 'member') throw httpError(403, 'usage_access_denied', 'Usage access is denied')
    if (!isUuid(this.ctx.params.projectId)) throw httpError(404, 'project_not_found', 'Project was not found')
    success(this.ctx, await this.ctx.service.usage.index.show({ tenantId: context.tenantId, projectId: this.ctx.params.projectId }, this.ctx.query))
  }

  async tenantSummary() {
    const context = await this.tenantContext()
    success(this.ctx, { subscription: await this.ctx.service.usage.index.subscriptionSummary(context.tenantId) })
  }

  async configureSubscription() {
    const context = await this.tenantContext()
    if (context.role !== 'owner') throw httpError(403, 'usage_access_denied', 'Usage subscription configuration is restricted to tenant owners')
    const summary = await this.ctx.service.usage.index.configureSubscription(context.tenantId, context.userId, this.ctx.request.body, this.ctx.state.requestId)
    if (!summary) throw httpError(409, 'subscription_unavailable', 'An active subscription is required')
    success(this.ctx, { subscription: summary })
  }

  async adjust() {
    const context = await this.tenantContext()
    if (context.role !== 'owner') throw httpError(403, 'usage_access_denied', 'Usage adjustments are restricted to tenant owners')
    success(this.ctx, { subscription: await this.ctx.service.usage.index.adjustUsage(context.tenantId, context.userId, this.ctx.request.body, this.ctx.state.requestId) })
  }

  private async tenantContext() {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId, false)
    if (context.role !== 'owner' && context.role !== 'admin' && context.role !== 'member') throw httpError(403, 'usage_access_denied', 'Usage access is denied')
    return context
  }
}
