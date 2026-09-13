import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { AnalyticsScope } from '../service/analytics/contracts'
import { isUuid } from '../service/tenancy'

export default class AnalyticsController extends Controller {
  async trend() {
    success(this.ctx, await this.ctx.service.analytics.index.trend(await this.scope(), this.ctx.query))
  }
  async dashboard() { success(this.ctx, await this.ctx.service.analytics.index.dashboard(await this.scope(), this.ctx.query)) }
  async events() { success(this.ctx, await this.ctx.service.analytics.index.events(await this.scope(), this.ctx.query)) }
  private async scope(): Promise<AnalyticsScope> {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId)
    this.ctx.service.tenancy.index.require(context, 'read')
    if (!isUuid(this.ctx.params.projectId)) throw httpError(404, 'project_not_found', 'Project was not found')
    return { tenantId: context.tenantId, projectId: this.ctx.params.projectId }
  }
}
