import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { TenantProjectScope } from '../service/projects'

export default class ProjectsController extends Controller {
  async index() {
    const items = await this.ctx.service.projects.index.domain.list(await this.tenantScope())
    success(this.ctx, { items })
  }

  async create() {
    const project = await this.ctx.service.projects.index.domain.create(await this.tenantScope(), this.ctx.request.body as never)
    success(this.ctx, { project }, 201)
  }

  async update() {
    const project = await this.ctx.service.projects.index.domain.update(await this.tenantScope(), this.ctx.params.projectId, this.ctx.request.body as never)
    success(this.ctx, { project })
  }

  async listKeys() {
    const items = await this.ctx.service.projects.index.domain.listKeys(await this.tenantScope(), this.ctx.params.projectId)
    success(this.ctx, { items })
  }

  async createKey() {
    const result = await this.ctx.service.projects.index.domain.createKey(await this.tenantScope(), this.ctx.params.projectId, this.ctx.request.body as never)
    success(this.ctx, result, 201)
  }

  async rotateKey() {
    const result = await this.ctx.service.projects.index.domain.rotateKey(await this.tenantScope(), this.ctx.params.projectId, this.ctx.params.keyId, this.ctx.request.body as never)
    success(this.ctx, result)
  }

  async disableKey() {
    const key = await this.ctx.service.projects.index.domain.disableKey(await this.tenantScope(), this.ctx.params.projectId, this.ctx.params.keyId)
    success(this.ctx, { key })
  }

  private async tenantScope(): Promise<TenantProjectScope> {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, principal.userId)
    return { tenantId: context.tenantId, userId: context.userId, role: context.role }
  }
}
