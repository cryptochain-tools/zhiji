import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { setAuthCookies } from './auth'
export default class SsoController extends Controller {
 async list(){success(this.ctx,await this.ctx.service.sso.index.list(await this.scope()))}
 async create(){success(this.ctx,await this.ctx.service.sso.index.create(await this.scope(),this.ctx.request.body,this.ctx.state.requestId),201)}
 async update(){success(this.ctx,await this.ctx.service.sso.index.update(await this.scope(),this.ctx.params.connectionId,this.ctx.request.body,this.ctx.state.requestId))}
 async link(){success(this.ctx,await this.ctx.service.sso.index.link(await this.scope(),this.ctx.params.connectionId,this.ctx.request.body,this.ctx.state.requestId),201)}
 async start(){success(this.ctx,await this.ctx.service.sso.index.start(this.ctx.params.tenantId,this.ctx.params.connectionId))}
 async callback(){const result=await this.ctx.service.sso.index.callback(this.ctx.query,this.ctx.state.requestId);const session=await this.ctx.service.auth.index.issueSession(result.user_id);setAuthCookies(this.ctx,session.token);success(this.ctx,{expires_at:session.expires_at})}
 private async scope(){const p=this.ctx.state.auth;if(!p)throw httpError(401,'authentication_required','Authentication is required');return this.ctx.service.tenancy.index.context(this.ctx.params.tenantId,p.userId,true)}
}
