import assert from 'node:assert/strict'
import { parseDashboardQuery, parseEventsQuery, parseTrendQuery } from '../../../../app/service/analytics/contracts'

describe('analytics trend contract', () => {
  const scope = { tenantId: 'tenant', projectId: 'project' }
  const now = new Date('2026-09-12T12:00:00.000Z')
  it('enforces a bounded UTC half-open time range and fixed granularity', () => {
    const query = parseTrendQuery(scope, { from: '2026-09-10T00:00:00Z', to: '2026-09-12T00:00:00Z', granularity: 'day', event_names: [ 'page_view', 'signup' ] }, now)
    assert.equal(query?.eventNames.length, 2)
    assert.equal(parseTrendQuery(scope, { from: '2026-01-01T00:00:00Z', to: '2026-09-12T00:00:00Z', granularity: 'day', event_names: [] }, now), null)
    assert.equal(parseTrendQuery(scope, { from: '2026-09-10T00:00:00Z', to: '2026-09-12T00:00:00Z', granularity: 'month', event_names: [] }, now), null)
  })
  it('bounds dashboard and event explorer queries before persistence', () => {
    const dashboard = parseDashboardQuery(scope, { from: '2026-09-10T00:00:00Z', to: '2026-09-12T00:00:00Z', granularity: 'day' }, now)
    assert.equal(dashboard?.granularity, 'day')
    const events = parseEventsQuery(scope, { from: '2026-09-10T00:00:00Z', to: '2026-09-12T00:00:00Z', name: 'signup', group_by: 'route', filters: [{ key: 'plan', operator: 'eq', value: 'pro' }], limit: 20 }, now)
    assert.deepEqual(events?.filters, [{ key: 'plan', value: 'pro' }])
    assert.equal(parseEventsQuery(scope, { from: '2026-09-10T00:00:00Z', to: '2026-09-12T00:00:00Z', filters: [{ key: 'x', operator: 'contains', value: 'x' }] }, now), null)
    assert.equal(parseEventsQuery(scope, { from: '2026-09-10T00:00:00Z', to: '2026-09-12T00:00:00Z', filters: [{ key: 'x', operator: 'eq', value: { unsafe: true } }] }, now), null)
  })
})
