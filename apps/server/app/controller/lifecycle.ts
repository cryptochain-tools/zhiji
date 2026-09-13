import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { LifecycleScope } from '../service/lifecycle/types'
import { isUuid } from '../service/tenancy'

export default class LifecycleController extends Controller {
  async createProof() {
    this.ctx.set('Cache-Control', 'no-store')
    success(this.ctx, await this.ctx.service.lifecycle.index.issueProof(await this.scope(), this.ctx.request.body), 201)
  }
  async createExport() { success(this.ctx, await this.ctx.service.lifecycle.index.requestSubjectExport(await this.scope(), this.ctx.get('Idempotency-Key'), this.ctx.request.body, this.ctx.state.requestId), 202) }
  async listExports() { success(this.ctx, await this.ctx.service.lifecycle.index.subjectExports(await this.scope())) }
  async showExport() { success(this.ctx, { job: await this.ctx.service.lifecycle.index.subjectJob(await this.scope(), this.ctx.params.jobId) }) }
  async downloadExport() {
    const result = await this.ctx.service.lifecycle.index.downloadSubjectExport(await this.scope(), this.ctx.params.jobId, this.ctx.query.token)
    if ('token' in result) return success(this.ctx, result)
    this.ctx.set('Cache-Control', 'no-store')
    this.ctx.set('Content-Type', 'application/json; charset=utf-8')
    this.ctx.set('Content-Disposition', 'attachment; filename="zhiji-data-subject-export.json"')
    this.ctx.body = result.contents
  }
  async createDeletion() { success(this.ctx, await this.ctx.service.lifecycle.index.requestSubjectDeletion(await this.scope(), this.ctx.get('Idempotency-Key'), this.ctx.request.body, this.ctx.state.requestId), 202) }
  async listDeletions() { success(this.ctx, await this.ctx.service.lifecycle.index.subjectDeletions(await this.scope())) }
  async showDeletion() { success(this.ctx, { job: await this.ctx.service.lifecycle.index.subjectJob(await this.scope(), this.ctx.params.jobId) }) }
  async requestProjectDeletion() { success(this.ctx, await this.ctx.service.lifecycle.index.requestProjectDeletion(await this.scope(), this.ctx.get('Idempotency-Key'), this.ctx.request.body, this.ctx.state.requestId), 202) }
  async showProjectDeletion() { success(this.ctx, await this.ctx.service.lifecycle.index.projectDeletion(await this.scope())) }
  async cancelProjectDeletion() { success(this.ctx, await this.ctx.service.lifecycle.index.cancelProjectDeletion(await this.scope(), this.ctx.state.requestId)) }
  private async scope(): Promise<LifecycleScope> {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    if (!isUuid(this.ctx.params.projectId)) throw httpError(404, 'project_not_found', 'Project was not found')
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId)
    return { tenantId: context.tenantId, projectId: this.ctx.params.projectId, actorUserId: principal.userId, role: context.role }
  }
}
