import { randomUUID } from 'node:crypto'
import { DatabaseClient } from '../database/types'
import { DashboardInput, InsightDefinition, InsightScope, InsightVisibility, SaveInsightInput, TileInput } from './contracts'

export interface InsightRow { id: string; name: string; description: string | null; kind: string; definition: InsightDefinition; definition_version: number; visibility: InsightVisibility; created_by: string; updated_by: string; created_at: Date; updated_at: Date; archived_at: Date | null }
export interface DashboardRow { id: string; name: string; description: string | null; visibility: 'project'; version: number; created_by: string; updated_by: string; created_at: Date; updated_at: Date; archived_at: Date | null }
export interface TileRow { id: string; saved_insight_id: string; position: number; width: number; height: number; title_override: string | null; tile_version: number; insight_name?: string; insight_kind?: string; insight_definition?: InsightDefinition }

export class InsightsRepository {
  constructor(private readonly database: DatabaseClient) {}
  async listInsights(scope: InsightScope, actorId: string, canReadProject: boolean): Promise<InsightRow[]> {
    const result = await this.database.query<InsightRow>(
      `SELECT id, name, description, kind, definition, definition_version, visibility, created_by, updated_by, created_at, updated_at, archived_at
       FROM saved_insights WHERE tenant_id = $1 AND project_id = $2 AND archived_at IS NULL
         AND (visibility = 'project' OR created_by = $3) ${canReadProject ? '' : "AND visibility = 'private'"}
       ORDER BY created_at DESC, id DESC LIMIT 200`, [ scope.tenantId, scope.projectId, actorId ],
    ); return result.rows
  }
  async getInsight(scope: InsightScope, id: string): Promise<InsightRow | null> {
    const result = await this.database.query<InsightRow>(`SELECT id, name, description, kind, definition, definition_version, visibility, created_by, updated_by, created_at, updated_at, archived_at FROM saved_insights WHERE tenant_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NULL`, [ scope.tenantId, scope.projectId, id ]); return result.rows[0] ?? null
  }
  async createInsight(scope: InsightScope, actorId: string, input: SaveInsightInput): Promise<InsightRow> {
    const id = randomUUID(); const result = await this.database.query<InsightRow>(
      `WITH inserted AS (INSERT INTO saved_insights (id,tenant_id,project_id,name,description,kind,definition,visibility,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$9) RETURNING id,name,description,kind,definition,definition_version,visibility,created_by,updated_by,created_at,updated_at,archived_at),
       audit AS (INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,metadata) SELECT $10,$2,$9,'insight_created','saved_insight',$1,jsonb_build_object('visibility',$8,'kind',$6) FROM inserted)
       SELECT * FROM inserted`, [ id, scope.tenantId, scope.projectId, input.name, input.description, input.definition.kind, JSON.stringify(input.definition), input.visibility, actorId, randomUUID() ],
    ); const row = result.rows[0]; if (!row) throw new Error('insight creation failed'); return row
  }
  async updateInsight(scope: InsightScope, id: string, actorId: string, input: SaveInsightInput, expected: number): Promise<InsightRow | null> {
    const result = await this.database.query<InsightRow>(
      `WITH updated AS (UPDATE saved_insights SET name=$4,description=$5,kind=$6,definition=$7::jsonb,visibility=$8,definition_version=definition_version+1,updated_by=$9,updated_at=now()
       WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL AND definition_version=$10
       RETURNING id,name,description,kind,definition,definition_version,visibility,created_by,updated_by,created_at,updated_at,archived_at),
       audit AS (INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,metadata) SELECT $11,$1,$9,'insight_updated','saved_insight',$3,jsonb_build_object('definition_version',definition_version) FROM updated)
       SELECT * FROM updated`, [ scope.tenantId, scope.projectId, id, input.name, input.description, input.definition.kind, JSON.stringify(input.definition), input.visibility, actorId, expected, randomUUID() ],
    ); return result.rows[0] ?? null
  }
  async archiveInsight(scope: InsightScope, id: string, actorId: string, expected: number): Promise<boolean> {
    const result = await this.database.query(
      `WITH updated AS (UPDATE saved_insights SET archived_at=now(),updated_by=$4,updated_at=now(),definition_version=definition_version+1 WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL AND definition_version=$5 RETURNING id),
       audit AS (INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,metadata) SELECT $6,$1,$4,'insight_archived','saved_insight',$3,'{}'::jsonb FROM updated) SELECT id FROM updated`, [ scope.tenantId, scope.projectId, id, actorId, expected, randomUUID() ],
    ); return result.rowCount === 1
  }
  async listDashboards(scope: InsightScope): Promise<DashboardRow[]> { const result = await this.database.query<DashboardRow>(`SELECT id,name,description,visibility,version,created_by,updated_by,created_at,updated_at,archived_at FROM dashboards WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 20`, [ scope.tenantId, scope.projectId ]); return result.rows }
  async getDashboard(scope: InsightScope, id: string): Promise<DashboardRow | null> { const result = await this.database.query<DashboardRow>(`SELECT id,name,description,visibility,version,created_by,updated_by,created_at,updated_at,archived_at FROM dashboards WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL`, [ scope.tenantId, scope.projectId, id ]); return result.rows[0] ?? null }
  async tiles(scope: InsightScope, dashboardId: string): Promise<TileRow[]> { const result = await this.database.query<TileRow>(`SELECT tile.id,tile.saved_insight_id,tile.position,tile.width,tile.height,tile.title_override,tile.tile_version, insight.name AS insight_name, insight.kind AS insight_kind, insight.definition AS insight_definition FROM dashboard_tiles tile JOIN saved_insights insight ON insight.tenant_id=tile.tenant_id AND insight.project_id=tile.project_id AND insight.id=tile.saved_insight_id WHERE tile.tenant_id=$1 AND tile.project_id=$2 AND tile.dashboard_id=$3 AND insight.archived_at IS NULL ORDER BY tile.position ASC`, [ scope.tenantId, scope.projectId, dashboardId ]); return result.rows }
  async createDashboard(scope: InsightScope, actorId: string, input: DashboardInput): Promise<DashboardRow | null> {
    const id=randomUUID(); const result=await this.database.query<DashboardRow>(`WITH locked AS (SELECT pg_advisory_xact_lock(hashtext($2::uuid::text || ':' || $3::uuid::text))), capacity AS (SELECT count(*) AS n FROM dashboards WHERE tenant_id=$2 AND project_id=$3 AND archived_at IS NULL AND EXISTS (SELECT 1 FROM locked)), inserted AS (INSERT INTO dashboards (id,tenant_id,project_id,name,description,created_by,updated_by) SELECT $1,$2,$3,$4,$5,$6,$6 WHERE (SELECT n FROM capacity)<20 RETURNING id,name,description,visibility,version,created_by,updated_by,created_at,updated_at,archived_at), audit AS (INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,metadata) SELECT $7,$2,$6,'dashboard_created','dashboard',$1,'{}'::jsonb FROM inserted) SELECT * FROM inserted`,[id,scope.tenantId,scope.projectId,input.name,input.description,actorId,randomUUID()]); return result.rows[0]??null
  }
  async updateDashboard(scope: InsightScope,id:string,actorId:string,input:DashboardInput):Promise<DashboardRow|null>{const result=await this.database.query<DashboardRow>(`WITH updated AS (UPDATE dashboards SET name=$4,description=$5,version=version+1,updated_by=$6,updated_at=now() WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL AND version=$7 RETURNING id,name,description,visibility,version,created_by,updated_by,created_at,updated_at,archived_at), audit AS (INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,metadata) SELECT $8,$1,$6,'dashboard_updated','dashboard',$3,jsonb_build_object('version',version) FROM updated) SELECT * FROM updated`,[scope.tenantId,scope.projectId,id,input.name,input.description,actorId,input.expectedVersion,randomUUID()]);return result.rows[0]??null}
  async archiveDashboard(scope:InsightScope,id:string,actorId:string,expected:number):Promise<boolean>{const result=await this.database.query(`WITH updated AS (UPDATE dashboards SET archived_at=now(),version=version+1,updated_by=$4,updated_at=now() WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL AND version=$5 RETURNING id), audit AS (INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,metadata) SELECT $6,$1,$4,'dashboard_archived','dashboard',$3,'{}'::jsonb FROM updated) SELECT id FROM updated`,[scope.tenantId,scope.projectId,id,actorId,expected,randomUUID()]);return result.rowCount===1}
  async replaceTiles(scope:InsightScope,dashboardId:string,actorId:string,expected:number,tiles:TileInput[]):Promise<DashboardRow|null>{
    const ids=tiles.map(tile=>tile.savedInsightId); const json=JSON.stringify(tiles.map(tile=>({id:tile.id??randomUUID(),saved_insight_id:tile.savedInsightId,position:tile.position,width:tile.width,height:tile.height,title_override:tile.titleOverride,tile_version:tile.tileVersion??1})))
    const result=await this.database.query<DashboardRow>(`WITH dashboard AS (SELECT id FROM dashboards WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND archived_at IS NULL AND version=$4 FOR UPDATE), valid AS (SELECT count(*)=cardinality($5::uuid[]) AS ok FROM saved_insights WHERE tenant_id=$1 AND project_id=$2 AND archived_at IS NULL AND id=ANY($5::uuid[]) AND visibility='project'), wiped AS (DELETE FROM dashboard_tiles WHERE dashboard_id=$3 AND EXISTS (SELECT 1 FROM dashboard) AND (SELECT ok FROM valid) RETURNING id), inserted AS (INSERT INTO dashboard_tiles (id,tenant_id,project_id,dashboard_id,saved_insight_id,position,width,height,title_override,tile_version) SELECT (row->>'id')::uuid,$1,$2,$3,(row->>'saved_insight_id')::uuid,(row->>'position')::integer,(row->>'width')::integer,(row->>'height')::integer,row->>'title_override',(row->>'tile_version')::integer FROM jsonb_array_elements($6::jsonb) row WHERE EXISTS(SELECT 1 FROM dashboard) AND (SELECT ok FROM valid) AND (SELECT count(*) >= 0 FROM wiped)), updated AS (UPDATE dashboards SET version=version+1,updated_by=$7,updated_at=now() WHERE id=$3 AND EXISTS(SELECT 1 FROM dashboard) AND (SELECT ok FROM valid) RETURNING id,name,description,visibility,version,created_by,updated_by,created_at,updated_at,archived_at), audit AS (INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,metadata) SELECT $8,$1,$7,'dashboard_tiles_replaced','dashboard',$3,jsonb_build_object('tile_count',jsonb_array_length($6::jsonb)) FROM updated) SELECT * FROM updated`,[scope.tenantId,scope.projectId,dashboardId,expected,ids,json,actorId,randomUUID()]);return result.rows[0]??null
  }
}
