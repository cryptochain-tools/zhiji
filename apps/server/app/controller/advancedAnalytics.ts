import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { AdvancedAnalyticsScope } from '../service/advancedAnalytics/contracts'
import { isUuid } from '../service/tenancy'

export default class AdvancedAnalyticsController extends Controller {
  async retention() { success(this.ctx, await this.execute('retention')) }
  async path() { success(this.ctx, await this.execute('path')) }

  private async execute(kind: 'retention' | 'path') {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId, false)
    this.ctx.service.tenancy.index.require(context, 'read')
    if (!isUuid(this.ctx.params.projectId)) throw httpError(404, 'project_not_found', 'Project was not found')
    const scope: AdvancedAnalyticsScope = { tenantId: context.tenantId, projectId: this.ctx.params.projectId }
    return kind === 'retention' ? this.ctx.service.advancedAnalytics.index.retention(scope, this.ctx.query) : this.ctx.service.advancedAnalytics.index.path(scope, this.ctx.query)
  }
}
