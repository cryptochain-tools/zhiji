import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { parseInsightInput, parseTiles } from '../../../../app/service/insights/contracts'
const definition = { schema_version: 1, kind: 'funnel', subject_kind: 'visitor', from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', timezone: 'UTC', steps: [ 'view', 'purchase' ] }
describe('saved insight contracts', () => {
  it('accepts only the bounded typed analytics definition', () => {
    assert.equal(parseInsightInput({ name: 'Checkout', visibility: 'private', definition }).definition.kind, 'funnel')
    assert.throws(() => parseInsightInput({ name: 'bad', visibility: 'project', definition: { ...definition, sql: 'select * from events' } }), { code: 'invalid_insight_definition' })
    assert.throws(() => parseInsightInput({ name: 'bad', visibility: 'project', definition: { ...definition, to: '2027-09-02T00:00:00.000Z' } }), { code: 'invalid_insight_definition' })
  })
  it('bounds dashboard layouts and requires unique positions', () => {
    const insight = '20000000-0000-4000-8000-000000000001'
    assert.equal(parseTiles({ expected_version: 1, tiles: [{ saved_insight_id: insight, position: 0, width: 6, height: 4 }] }).tiles.length, 1)
    assert.throws(() => parseTiles({ expected_version: 1, tiles: Array.from({ length: 25 }, (_, position) => ({ saved_insight_id: insight, position, width: 1, height: 1 })) }), { code: 'invalid_dashboard' })
  })
})
