import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { ReplayScope } from '../service/replay'
import { isUuid } from '../service/tenancy'

/** Replay is intentionally owner/admin only; no mutation or sharing endpoint exists. */
export default class ReplayController extends Controller {
  async index() { success(this.ctx, await this.ctx.service.replay.index.list(await this.scope(), this.ctx.query)) }
  async show() { success(this.ctx, await this.ctx.service.replay.index.detail(await this.scope(), this.sessionId())) }
  async chunks() { success(this.ctx, await this.ctx.service.replay.index.chunks(await this.scope(), this.sessionId(), this.ctx.query)) }

  private sessionId(): string { const value = this.ctx.params.replaySessionId; if (!isUuid(value)) throw httpError(404, 'replay_not_found', 'Replay session was not found'); return value }
  private async scope(): Promise<ReplayScope> {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId, false)
    this.ctx.service.tenancy.index.require(context, 'manage_projects')
    if (!isUuid(this.ctx.params.projectId)) throw httpError(404, 'project_not_found', 'Project was not found')
    return { tenantId: context.tenantId, projectId: this.ctx.params.projectId }
  }
}
