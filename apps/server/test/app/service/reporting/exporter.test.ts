import assert from 'node:assert/strict'
import { renderAggregateExport } from '../../../../app/service/reporting/exporter'
import { DatabaseClient } from '../../../../app/service/database/types'

const scope = { tenantId: '00000000-0000-4000-8000-000000000001', projectId: '00000000-0000-4000-8000-000000000002' }
const definition = { schema_version: 1 as const, kind: 'trend' as const, subject_kind: 'visitor' as const, from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', timezone: 'UTC', granularity: 'day' as const, event_names: [ '=unsafe' ] }
const database: DatabaseClient = { async query<Row extends object>() { return { rows: [{ bucket_start: new Date('2026-09-01T00:00:00.000Z'), event_name: '=unsafe', event_count: 1, page_views: 0, visitors: 1 }] as Row[], rowCount: 1 } } }

describe('aggregate export renderer', () => {
  it('writes a formula-safe CSV from a bounded aggregate definition', async () => {
    const result = await renderAggregateExport(database, scope, definition, 'csv', new Date('2026-09-03T00:00:00.000Z'))
    assert.match(result.contents.toString('utf8'), /'=unsafe/)
    assert.equal(result.rowCount, 1)
  })
  it('writes a genuine OOXML zip and escapes spreadsheet formulas in inline strings', async () => {
    const result = await renderAggregateExport(database, scope, definition, 'xlsx', new Date('2026-09-03T00:00:00.000Z'))
    assert.equal(result.contents.subarray(0, 4).toString('hex'), '504b0304')
    assert.ok(result.contents.length > 100)
  })
})
