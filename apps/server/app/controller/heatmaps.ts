import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { isUuid } from '../service/tenancy'

export default class HeatmapsController extends Controller {
  async list() {
    const scope = await this.scope()
    success(this.ctx, await this.ctx.service.heatmaps.index.list(scope, this.ctx.query))
  }

  async detail() {
    const scope = await this.scope()
    success(this.ctx, await this.ctx.service.heatmaps.index.detail(scope, this.ctx.params.heatmapId, this.ctx.query))
  }

  async show() {
    const scope = await this.scope()
    success(this.ctx, await this.ctx.service.heatmaps.index.show(scope, this.ctx.query))
  }

  private async scope() {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId, false)
    this.ctx.service.tenancy.index.require(context, 'read')
    if (!isUuid(this.ctx.params.projectId)) throw httpError(404, 'project_not_found', 'Project was not found')
    return { tenantId: context.tenantId, projectId: this.ctx.params.projectId }
  }
}
