import { Controller } from 'egg'
import { httpError, success } from '../lib/http'

export default class UserJourneysController extends Controller {
  async index() {
    const { context, scope } = await this.scope()
    this.ctx.service.tenancy.index.require(context, 'manage_settings')
    success(this.ctx, await this.ctx.service.userJourneys.index.directory(scope, this.ctx.query))
  }

  async show() {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const { context, scope } = await this.scope()
    this.ctx.service.tenancy.index.require(context, 'manage_settings')
    success(this.ctx, await this.ctx.service.userJourneys.index.show(scope, this.ctx.params.businessUserId, this.ctx.query, principal.userId, this.ctx.state.requestId))
  }

  private async scope() {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId)
    await this.ctx.service.tenancy.index.requireProject(context, this.ctx.params.projectId)
    return { context, scope: { tenantId: context.tenantId, projectId: this.ctx.params.projectId } }
  }
}
