import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { InsightsManagementService } from '../../../../app/service/insights'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'
const scope = { tenantId: '20000000-0000-4000-8000-000000000001', projectId: '20000000-0000-4000-8000-000000000002' }
const actor = '20000000-0000-4000-8000-000000000003'; const id = '20000000-0000-4000-8000-000000000004'
const definition = { schema_version: 1, kind: 'funnel', subject_kind: 'visitor', from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', timezone: 'UTC', steps: [ 'view', 'purchase' ] }
const row = { id, name: 'Checkout', description: null, kind: 'funnel', definition, definition_version: 1, visibility: 'private', created_by: actor, updated_by: actor, created_at: new Date(), updated_at: new Date(), archived_at: null }
describe('InsightsManagementService', () => {
  it('keeps private insights invisible to other project readers', async () => {
    const database: DatabaseClient = { query: async <Row extends object>(): Promise<QueryResult<Row>> => ({ rows: [row as Row], rowCount: 1 }) }
    await assert.rejects(new InsightsManagementService(database).show(scope, '20000000-0000-4000-8000-000000000009', id), { code: 'resource_not_found' })
  })
  it('uses an optimistic, scoped update with safe audit metadata', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => { calls.push({ text, values }); return { rows: [row as Row], rowCount: 1 } } }
    await new InsightsManagementService(database).update(scope, actor, false, id, { name: 'Checkout', visibility: 'private', definition, expected_definition_version: 1 })
    assert.match(calls[1]?.text ?? '', /tenant_id=\$1 AND project_id=\$2 AND id=\$3/)
    assert.match(calls[1]?.text ?? '', /definition_version=\$10/)
    assert.match(calls[1]?.text ?? '', /INSERT INTO audit_logs/)
  })
})
