import { Controller } from 'egg'
import { httpError, success } from '../lib/http'

export default class InvitationsController extends Controller {
  async create() { success(this.ctx, await this.ctx.service.invitations.index.create(await this.scope(), this.ctx.get('Idempotency-Key'), this.ctx.request.body, this.ctx.state.requestId), 201) }
  async resend() { success(this.ctx, await this.ctx.service.invitations.index.resend(await this.scope(), this.ctx.params.invitationId, this.ctx.get('Idempotency-Key'), this.ctx.state.requestId), 201) }
  async accept() { success(this.ctx, await this.ctx.service.invitations.index.accept(this.ctx.request.body, this.ctx.state.requestId)) }
  private async scope() {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    return this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId, true)
  }
}
