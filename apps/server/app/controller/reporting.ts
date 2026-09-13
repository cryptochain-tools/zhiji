import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { ReportingScope } from '../service/reporting/contracts'
import { isUuid } from '../service/tenancy'
export default class ReportingController extends Controller {
  async performance() { success(this.ctx, await this.ctx.service.reporting.index.performance(await this.scope(false), this.ctx.query)) }
  async performanceDetail() { success(this.ctx, await this.ctx.service.reporting.index.performanceDetail(await this.scope(false), this.ctx.query, this.ctx.params.pageKey)) }
  async createExport() { const principal = this.requirePrincipal(); success(this.ctx, await this.ctx.service.reporting.index.requestExport(await this.scope(false), principal.userId, this.ctx.get('Idempotency-Key'), this.ctx.request.body), 202) }
  async showExport() { const principal = this.requirePrincipal(); success(this.ctx, await this.ctx.service.reporting.index.showExport(await this.scope(false), principal.userId, this.ctx.params.exportJobId)) }
  async cancelExport() { const principal = this.requirePrincipal(); success(this.ctx, await this.ctx.service.reporting.index.cancelExport(await this.scope(false), principal.userId, this.ctx.params.exportJobId)) }
  async downloadExport() { const principal = this.requirePrincipal(); const result = await this.ctx.service.reporting.index.downloadExport(await this.scope(false), principal.userId, this.ctx.params.exportJobId, this.ctx.query.token); if ('token' in result) return success(this.ctx, result); this.ctx.set('Cache-Control', 'no-store'); this.ctx.set('Content-Type', result.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8'); this.ctx.set('Content-Disposition', `attachment; filename="zhiji-analytics.${result.format}"`); this.ctx.body = result.contents }
  private requirePrincipal() { const value = this.ctx.state.auth; if (!value) throw httpError(401, 'authentication_required', 'Authentication is required'); return value }
  private async scope(write: boolean): Promise<ReportingScope> { const principal = this.requirePrincipal(); const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId, write); this.ctx.service.tenancy.index.require(context, write ? 'manage_projects' : 'read'); if (!isUuid(this.ctx.params.projectId)) throw httpError(404, 'project_not_found', 'Project was not found'); return { tenantId: context.tenantId, projectId: this.ctx.params.projectId } }
}
