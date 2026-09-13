import { Controller } from 'egg'
import { httpError, success } from '../lib/http'

/** Tenant-wide audit evidence is restricted to tenant administrators. */
export default class AuditLogsController extends Controller {
  async index() {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId)
    this.ctx.service.tenancy.index.require(context, 'manage_settings')
    success(this.ctx, await this.ctx.service.auditLogs.index.list({ tenantId: context.tenantId }, this.ctx.query))
  }
}
