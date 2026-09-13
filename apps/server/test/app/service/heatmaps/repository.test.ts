import assert from 'node:assert/strict'
import { DatabaseClient } from '../../../../app/service/database/types'
import { HeatmapRepository } from '../../../../app/service/heatmaps/repository'

const scope = { tenantId: 'tenant', projectId: 'project' }
const query = { pageKey: '/pricing', from: new Date('2026-01-01'), to: new Date('2026-01-02') }

describe('HeatmapRepository', () => {
  it('uses scoped daily bins, never the raw behavior table', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = { async query<Row extends object>(text: string, values?: readonly unknown[]) { calls.push({ text, values }); return { rows: [] as Row[], rowCount: 0 } } }
    await new HeatmapRepository(database).bins(scope, query)
    assert.match(calls[0]?.text ?? '', /FROM heatmap_bins_daily/)
    assert.doesNotMatch(calls[0]?.text ?? '', /FROM behavior_events/)
    assert.deepEqual(calls[0]?.values?.slice(0, 3), [ 'tenant', 'project', '/pricing' ])
  })

  it('keeps series and optional screenshot presence inside tenant/project scope', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = { async query<Row extends object>(text: string, values?: readonly unknown[]) { calls.push({ text, values }); return { rows: [] as Row[], rowCount: 0 } } }
    await new HeatmapRepository(database).series(scope, query)
    assert.match(calls[0]?.text ?? '', /FROM heatmap_series_daily/)
    assert.match(calls[0]?.text ?? '', /heatmap_screenshots/)
    assert.match(calls[0]?.text ?? '', /series\.tenant_id = \$1 AND series\.project_id = \$2/)
  })
})
