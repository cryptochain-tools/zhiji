import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { AlertScope } from '../service/alerts/contracts'
import { isUuid } from '../service/tenancy'
export default class AlertsController extends Controller {
  async listTargets() { success(this.ctx, await this.ctx.service.alerts.index.listTargets(await this.scope(), this.ctx.query)) }
  async listRules() { success(this.ctx, await this.ctx.service.alerts.index.listRules(await this.scope(), this.ctx.query)) }
  async listInstances() { success(this.ctx, await this.ctx.service.alerts.index.listInstances(await this.scope(), this.ctx.query)) }
  async listDeliveries() { success(this.ctx, await this.ctx.service.alerts.index.listDeliveries(await this.scope(), this.ctx.query)) }
  async createTarget() { const principal = this.requirePrincipal(); success(this.ctx, await this.ctx.service.alerts.index.createTarget(await this.scope(), principal.userId, this.ctx.request.body), 201) }
  async updateTarget() { const principal = this.requirePrincipal(); success(this.ctx, await this.ctx.service.alerts.index.updateTarget(await this.scope(), this.ctx.params.targetId, principal.userId, this.ctx.request.body)) }
  async disableTarget() { const principal = this.requirePrincipal(); success(this.ctx, await this.ctx.service.alerts.index.disableTarget(await this.scope(), this.ctx.params.targetId, principal.userId, this.ctx.request.body)) }
  async createRule() { const principal = this.requirePrincipal(); success(this.ctx, await this.ctx.service.alerts.index.createRule(await this.scope(), principal.userId, this.ctx.request.body), 201) }
  async updateRule() { const principal = this.requirePrincipal(); success(this.ctx, await this.ctx.service.alerts.index.updateRule(await this.scope(), this.ctx.params.ruleId, principal.userId, this.ctx.request.body)) }
  async disableRule() { const principal = this.requirePrincipal(); success(this.ctx, await this.ctx.service.alerts.index.disableRule(await this.scope(), this.ctx.params.ruleId, principal.userId, this.ctx.request.body)) }
  private requirePrincipal() { const value = this.ctx.state.auth; if (!value) throw httpError(401, 'authentication_required', 'Authentication is required'); return value }
  private async scope(): Promise<AlertScope> { const principal = this.requirePrincipal(); const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId, true); this.ctx.service.tenancy.index.require(context, 'manage_projects'); if (!isUuid(this.ctx.params.projectId)) throw httpError(404, 'project_not_found', 'Project was not found'); return { tenantId: context.tenantId, projectId: this.ctx.params.projectId } }
}
