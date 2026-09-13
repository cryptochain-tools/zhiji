import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { InsightScope, parseDashboardInput, parseInsightInput, parseInsightUpdate, parseTiles } from './contracts'
import { DashboardRow, InsightRow, InsightsRepository, TileRow } from './repository'

export class InsightsManagementService {
  constructor(private readonly database: import('../database/types').DatabaseClient) {}
  async list(scope: InsightScope, actorId: string) { return { items: (await new InsightsRepository(this.database).listInsights(scope, actorId, true)).map(insightDto) } }
  async show(scope: InsightScope, actorId: string, id: string) { const row = await this.requireReadable(scope, actorId, id); return insightDto(row) }
  async create(scope: InsightScope, actorId: string, canManageProject: boolean, raw: unknown) {
    const input = parseInsightInput(raw); if (input.visibility === 'project' && !canManageProject) throw forbidden()
    return insightDto(await new InsightsRepository(this.database).createInsight(scope, actorId, input))
  }
  async update(scope: InsightScope, actorId: string, canManageProject: boolean, id: string, raw: unknown) {
    await this.requireEditable(scope, actorId, canManageProject, id); const input = parseInsightUpdate(raw)
    if (input.visibility === 'project' && !canManageProject) throw forbidden()
    const updated = await new InsightsRepository(this.database).updateInsight(scope, id, actorId, input, input.expectedDefinitionVersion)
    if (updated) return insightDto(updated)
    const current = await new InsightsRepository(this.database).getInsight(scope, id)
    if (!current) throw missing(); throw httpError(409, 'insight_version_conflict', 'Insight has changed', { current_definition_version: String(current.definition_version), current_name: current.name })
  }
  async archive(scope: InsightScope, actorId: string, canManageProject: boolean, id: string, expected: number) {
    await this.requireEditable(scope, actorId, canManageProject, id)
    if (await new InsightsRepository(this.database).archiveInsight(scope, id, actorId, expected)) return { archived: true }
    const current = await new InsightsRepository(this.database).getInsight(scope, id)
    if (!current) throw missing(); throw httpError(409, 'insight_version_conflict', 'Insight has changed', { current_definition_version: String(current.definition_version), current_name: current.name })
  }
  async listDashboards(scope: InsightScope) { return { items: (await new InsightsRepository(this.database).listDashboards(scope)).map(dashboardDto) } }
  async showDashboard(scope: InsightScope, id: string) { const repo = new InsightsRepository(this.database); const dashboard = await repo.getDashboard(scope,id); if (!dashboard) throw missing(); return { ...dashboardDto(dashboard), tiles: (await repo.tiles(scope,id)).map(tileDto) } }
  async createDashboard(scope:InsightScope,actorId:string,raw:unknown){const row=await new InsightsRepository(this.database).createDashboard(scope,actorId,parseDashboardInput(raw));if(!row)throw httpError(422,'dashboard_limit_exceeded','A project may have at most 20 active dashboards');return dashboardDto(row)}
  async updateDashboard(scope:InsightScope,actorId:string,id:string,raw:unknown){const input=parseDashboardInput(raw,true);const repo=new InsightsRepository(this.database);const row=await repo.updateDashboard(scope,id,actorId,input);if(row)return dashboardDto(row);const current=await repo.getDashboard(scope,id);if(!current)throw missing();throw dashboardConflict(current)}
  async archiveDashboard(scope:InsightScope,actorId:string,id:string,expected:number){if(!Number.isSafeInteger(expected)||expected<1)throw httpError(400,'invalid_dashboard','Dashboard is invalid');const repo=new InsightsRepository(this.database);if(await repo.archiveDashboard(scope,id,actorId,expected))return {archived:true};const current=await repo.getDashboard(scope,id);if(!current)throw missing();throw dashboardConflict(current)}
  async replaceTiles(scope:InsightScope,actorId:string,id:string,raw:unknown){const input=parseTiles(raw);const repo=new InsightsRepository(this.database);const row=await repo.replaceTiles(scope,id,actorId,input.expectedVersion,input.tiles);if(row)return { ...dashboardDto(row), tiles:(await repo.tiles(scope,id)).map(tileDto) };const current=await repo.getDashboard(scope,id);if(!current)throw missing();throw dashboardConflict(current)}
  private async requireReadable(scope:InsightScope,actor:string,id:string):Promise<InsightRow>{const row=await new InsightsRepository(this.database).getInsight(scope,id);if(!row)throw missing();if(row.visibility==='private'&&row.created_by!==actor)throw missing();return row}
  private async requireEditable(scope:InsightScope,actor:string,canManageProject:boolean,id:string):Promise<InsightRow>{const row=await this.requireReadable(scope,actor,id);if(row.visibility==='project'&&!canManageProject)throw forbidden();if(row.visibility==='private'&&row.created_by!==actor)throw forbidden();return row}
}
export default class InsightsService extends Service {
  private domain(){const database=this.config.zhiji.database;if(!database?.configured)throw httpError(503,'insights_unavailable','Saved insights are unavailable');return new InsightsManagementService(database)}
  list(scope:InsightScope,actor:string){return this.domain().list(scope,actor)} show(scope:InsightScope,actor:string,id:string){return this.domain().show(scope,actor,id)} create(scope:InsightScope,actor:string,manage:boolean,raw:unknown){return this.domain().create(scope,actor,manage,raw)} update(scope:InsightScope,actor:string,manage:boolean,id:string,raw:unknown){return this.domain().update(scope,actor,manage,id,raw)} archive(scope:InsightScope,actor:string,manage:boolean,id:string,version:number){return this.domain().archive(scope,actor,manage,id,version)} listDashboards(scope:InsightScope){return this.domain().listDashboards(scope)} showDashboard(scope:InsightScope,id:string){return this.domain().showDashboard(scope,id)} createDashboard(scope:InsightScope,actor:string,raw:unknown){return this.domain().createDashboard(scope,actor,raw)} updateDashboard(scope:InsightScope,actor:string,id:string,raw:unknown){return this.domain().updateDashboard(scope,actor,id,raw)} archiveDashboard(scope:InsightScope,actor:string,id:string,version:number){return this.domain().archiveDashboard(scope,actor,id,version)} replaceTiles(scope:InsightScope,actor:string,id:string,raw:unknown){return this.domain().replaceTiles(scope,actor,id,raw)}
}
function insightDto(row:InsightRow){return {id:row.id,name:row.name,description:row.description,kind:row.kind,definition:row.definition,definition_version:row.definition_version,visibility:row.visibility,created_by:row.created_by,updated_by:row.updated_by,created_at:row.created_at.toISOString(),updated_at:row.updated_at.toISOString()}}
function dashboardDto(row:DashboardRow){return{id:row.id,name:row.name,description:row.description,visibility:row.visibility,version:row.version,created_by:row.created_by,updated_by:row.updated_by,created_at:row.created_at.toISOString(),updated_at:row.updated_at.toISOString()}}
function tileDto(row:TileRow){return{id:row.id,saved_insight_id:row.saved_insight_id,position:row.position,width:row.width,height:row.height,title_override:row.title_override,tile_version:row.tile_version,insight:row.insight_name?{name:row.insight_name,kind:row.insight_kind,definition:row.insight_definition}:undefined}}
function missing():never{throw httpError(404,'resource_not_found','Resource was not found')} function forbidden():never{throw httpError(403,'forbidden','Permission is denied')} function dashboardConflict(row:DashboardRow):ReturnType<typeof httpError>{return httpError(409,'dashboard_version_conflict','Dashboard has changed',{current_version:String(row.version),current_name:row.name})}
