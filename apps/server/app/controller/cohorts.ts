import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { CohortScope } from '../service/cohorts/contracts'
import { isUuid } from '../service/tenancy'
export default class CohortsController extends Controller {
  async list(){const {scope,actor}=await this.read();success(this.ctx,await this.ctx.service.cohorts.index.list(scope,actor.userId))}
  async show(){const {scope,actor}=await this.read();this.id();success(this.ctx,await this.ctx.service.cohorts.index.show(scope,actor.userId,this.ctx.params.cohortId))}
  async create(){const {scope,actor,manage}=await this.write();success(this.ctx,await this.ctx.service.cohorts.index.create(scope,actor.userId,manage,this.ctx.request.body),201)}
  async update(){const {scope,actor,manage}=await this.write();this.id();success(this.ctx,await this.ctx.service.cohorts.index.update(scope,actor.userId,manage,this.ctx.params.cohortId,this.ctx.request.body))}
  async destroy(){const {scope,actor,manage}=await this.write();this.id();success(this.ctx,await this.ctx.service.cohorts.index.archive(scope,actor.userId,manage,this.ctx.params.cohortId,Number(this.ctx.request.body?.expected_definition_version)))}
  async preview(){const {scope,actor}=await this.read();this.id();success(this.ctx,await this.ctx.service.cohorts.index.preview(scope,actor.userId,this.ctx.params.cohortId,this.ctx.request.body))}
  private principal(){const actor=this.ctx.state.auth;if(!actor)throw httpError(401,'authentication_required','Authentication is required');return actor}
  private async read(){const actor=this.principal();const context=await this.ctx.service.tenancy.index.context(this.ctx.params.tenantId,actor.userId);this.ctx.service.tenancy.index.require(context,'read');if(!isUuid(this.ctx.params.projectId))throw httpError(404,'resource_not_found','Resource was not found');return{scope:{tenantId:context.tenantId,projectId:this.ctx.params.projectId} as CohortScope,actor,manage:context.role==='owner'||context.role==='admin',role:context.role}}
  private async write(){const result=await this.read();if(result.role==='viewer')throw httpError(403,'forbidden','Permission is denied');return result}
  private id(){if(!isUuid(this.ctx.params.cohortId))throw httpError(404,'resource_not_found','Resource was not found')}
}
