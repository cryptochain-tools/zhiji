import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { FunnelScope } from '../service/funnel/contracts'
import { isUuid } from '../service/tenancy'

export default class FunnelController extends Controller {
  async show() {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId, false)
    this.ctx.service.tenancy.index.require(context, 'read')
    if (!isUuid(this.ctx.params.projectId)) throw httpError(404, 'project_not_found', 'Project was not found')
    const scope: FunnelScope = { tenantId: context.tenantId, projectId: this.ctx.params.projectId }
    success(this.ctx, await this.ctx.service.funnel.index.show(scope, this.ctx.query))
  }
}
