import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { ErrorScope } from '../service/errors/contracts'
import { isUuid } from '../service/tenancy'

export default class ErrorsController extends Controller {
  async index() { success(this.ctx, await this.ctx.service.errors.index.list(await this.scope(), this.ctx.query)) }
  async show() { success(this.ctx, await this.ctx.service.errors.index.detail(await this.scope(), this.ctx.params.groupId, this.ctx.query)) }
  async occurrences() { success(this.ctx, await this.ctx.service.errors.index.occurrences(await this.scope(), this.ctx.params.groupId, this.ctx.query)) }
  async patchStatus() {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    success(this.ctx, await this.ctx.service.errors.index.patchStatus(await this.scope(true), this.ctx.params.groupId, this.ctx.request.body, principal.userId))
  }

  private async scope(write = false): Promise<ErrorScope> {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId, write)
    this.ctx.service.tenancy.index.require(context, write ? 'update_error_state' : 'read')
    if (!isUuid(this.ctx.params.projectId)) throw httpError(404, 'project_not_found', 'Project was not found')
    return { tenantId: context.tenantId, projectId: this.ctx.params.projectId }
  }
}
