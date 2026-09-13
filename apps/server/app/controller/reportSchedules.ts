import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { ReportScheduleScope } from '../service/reportSchedules/contracts'
import { isUuid } from '../service/tenancy'

export default class ReportSchedulesController extends Controller {
  async list() { success(this.ctx, await this.ctx.service.reportSchedules.index.list(await this.scope(false), this.ctx.query)) }
  async show() { success(this.ctx, await this.ctx.service.reportSchedules.index.show(await this.scope(false), this.ctx.params.scheduleId)) }
  async create() { const principal = this.principal(); success(this.ctx, await this.ctx.service.reportSchedules.index.create(await this.scope(true), principal.userId, this.ctx.request.body), 201) }
  async update() { const principal = this.principal(); success(this.ctx, await this.ctx.service.reportSchedules.index.update(await this.scope(true), this.ctx.params.scheduleId, principal.userId, this.ctx.request.body)) }
  async disable() { const principal = this.principal(); success(this.ctx, await this.ctx.service.reportSchedules.index.disable(await this.scope(true), this.ctx.params.scheduleId, principal.userId, this.ctx.request.body)) }
  async retryRun() { const principal = this.principal(); success(this.ctx, await this.ctx.service.reportSchedules.index.retryRun(await this.scope(true), this.ctx.params.scheduleId, this.ctx.params.runId, principal.userId)) }
  private principal() { const principal = this.ctx.state.auth; if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required'); return principal }
  private async scope(write: boolean): Promise<ReportScheduleScope> {
    const principal = this.principal(); if (!isUuid(this.ctx.params.projectId)) throw httpError(404, 'project_not_found', 'Project was not found')
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId, write)
    if (write && context.role !== 'owner') throw httpError(403, 'forbidden', 'Report schedule changes require owner role')
    this.ctx.service.tenancy.index.require(context, 'read')
    return { tenantId: context.tenantId, projectId: this.ctx.params.projectId }
  }
}
