import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { InsightScope } from '../service/insights/contracts'
import { isUuid } from '../service/tenancy'
export default class InsightsController extends Controller {
  async list(){const {scope,actor}=await this.read();success(this.ctx,await this.ctx.service.insights.index.list(scope,actor.userId))}
  async show(){const {scope,actor}=await this.read();this.id();success(this.ctx,await this.ctx.service.insights.index.show(scope,actor.userId,this.ctx.params.insightId))}
  async create(){const {scope,actor,manage}=await this.write(false);success(this.ctx,await this.ctx.service.insights.index.create(scope,actor.userId,manage,this.ctx.request.body),201)}
  async update(){const {scope,actor,manage}=await this.write(false);this.id();success(this.ctx,await this.ctx.service.insights.index.update(scope,actor.userId,manage,this.ctx.params.insightId,this.ctx.request.body))}
  async destroy(){const {scope,actor,manage}=await this.write(false);this.id();success(this.ctx,await this.ctx.service.insights.index.archive(scope,actor.userId,manage,this.ctx.params.insightId,Number(this.ctx.request.body?.expected_definition_version)))}
  async listDashboards(){const {scope}=await this.read();success(this.ctx,await this.ctx.service.insights.index.listDashboards(scope))}
  async showDashboard(){const {scope}=await this.read();this.dashboardId();success(this.ctx,await this.ctx.service.insights.index.showDashboard(scope,this.ctx.params.dashboardId))}
  async createDashboard(){const {scope,actor}=await this.write(true);success(this.ctx,await this.ctx.service.insights.index.createDashboard(scope,actor.userId,this.ctx.request.body),201)}
  async updateDashboard(){const {scope,actor}=await this.write(true);this.dashboardId();success(this.ctx,await this.ctx.service.insights.index.updateDashboard(scope,actor.userId,this.ctx.params.dashboardId,this.ctx.request.body))}
  async destroyDashboard(){const {scope,actor}=await this.write(true);this.dashboardId();success(this.ctx,await this.ctx.service.insights.index.archiveDashboard(scope,actor.userId,this.ctx.params.dashboardId,Number(this.ctx.request.body?.expected_version)))}
  async replaceTiles(){const {scope,actor}=await this.write(true);this.dashboardId();success(this.ctx,await this.ctx.service.insights.index.replaceTiles(scope,actor.userId,this.ctx.params.dashboardId,this.ctx.request.body))}
  private principal(){const actor=this.ctx.state.auth;if(!actor)throw httpError(401,'authentication_required','Authentication is required');return actor}
  private async read(){const actor=this.principal();const context=await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId,actor.userId);this.ctx.service.tenancy.index.require(context,'read');this.project();return {scope:{tenantId:context.tenantId,projectId:this.ctx.params.projectId} as InsightScope,actor,role:context.role,manage:context.role==='owner'||context.role==='admin'}}
  private async write(projectOnly:boolean){const result=await this.read();if(projectOnly&& !result.manage)throw httpError(403,'forbidden','Permission is denied');if(!projectOnly&&result.role==='viewer')throw httpError(403,'forbidden','Permission is denied');return result}
  private project(){if(!isUuid(this.ctx.params.projectId))throw httpError(404,'resource_not_found','Resource was not found')} private id(){if(!isUuid(this.ctx.params.insightId))throw httpError(404,'resource_not_found','Resource was not found')} private dashboardId(){if(!isUuid(this.ctx.params.dashboardId))throw httpError(404,'resource_not_found','Resource was not found')}
}
