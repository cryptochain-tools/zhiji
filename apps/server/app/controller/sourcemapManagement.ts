import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { SourceMapManagementScope } from '../service/sourcemapManagement'
import { isUuid } from '../service/tenancy'

/** Source Map content is never read through this controller, only safe metadata. */
export default class SourceMapManagementController extends Controller {
  async index() { success(this.ctx, await this.ctx.service.sourcemapManagement.index.list(await this.scope())) }
  async supersede() {
    const principal = this.principal()
    const artifactId = this.ctx.params.artifactId
    if (!isUuid(artifactId)) throw httpError(404, 'sourcemap_artifact_not_found', 'Source Map artifact was not found')
    success(this.ctx, await this.ctx.service.sourcemapManagement.index.supersede(await this.scope(), principal.userId, artifactId, this.ctx.request.body, this.ctx.state.requestId))
  }
  private principal() { const principal = this.ctx.state.auth; if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required'); return principal }
  private async scope(): Promise<SourceMapManagementScope> {
    const context = await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId, this.principal().userId)
    this.ctx.service.tenancy.index.require(context, 'manage_projects')
    if (!isUuid(this.ctx.params.projectId)) throw httpError(404, 'project_not_found', 'Project was not found')
    return { tenantId: context.tenantId, projectId: this.ctx.params.projectId }
  }
}
