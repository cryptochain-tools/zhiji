import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { CohortsManagementService } from '../../../../app/service/cohorts'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'
const scope={tenantId:'20000000-0000-4000-8000-000000000001',projectId:'20000000-0000-4000-8000-000000000002'};const actor='20000000-0000-4000-8000-000000000003';const id='20000000-0000-4000-8000-000000000004'
const definition={schema_version:1 as const,event_name:'purchase',min_occurrences:1,window:{kind:'relative' as const,days:30}}
const row={id,name:'Buyers',description:null,subject_kind:'business_user' as const,definition,definition_version:1,visibility:'private' as const,created_by:actor,updated_by:actor,created_at:new Date(),updated_at:new Date(),archived_at:null}
describe('CohortsManagementService',()=>{
  it('hides private cohorts and never returns members from previews',async()=>{const database:DatabaseClient={query:async<Row extends object>():Promise<QueryResult<Row>>=>({rows:[row as Row],rowCount:1})};await assert.rejects(new CohortsManagementService(database).show(scope,'20000000-0000-4000-8000-000000000009',id),{code:'resource_not_found'})})
  it('uses project scope and event IDs for deduplicated business-user previews',async()=>{const calls:Array<{text:string;values?:readonly unknown[]}> = [];const snapshot={id,cohort_id:id,definition_version:1,calculated_at:new Date(),range_from:new Date('2026-08-13T00:00:00Z'),range_to:new Date('2026-09-12T00:00:00Z'),subject_kind:'business_user',member_count:3,query_hash:Buffer.alloc(32),expires_at:new Date('2026-10-12T00:00:00Z')};let count=0;const database:DatabaseClient={query:async<Row extends object>(text:string,values?:readonly unknown[]):Promise<QueryResult<Row>>=>{calls.push({text,values});count++;return{rows:[(count===1?row:snapshot) as Row],rowCount:1}}};const result=await new CohortsManagementService(database).preview(scope,actor,id,{});assert.equal(result.snapshot.member_count,3);assert.equal('members' in result.snapshot,false);assert.match(calls[1]?.text??'',/COUNT\(DISTINCT id\)/);assert.match(calls[1]?.text??'',/e\.tenant_id=\$1 AND e\.project_id=\$2/)})
})
