import assert from 'node:assert/strict'
import { escapeCsvCell, parseExportRequest, parsePerformanceDetailQuery, parsePerformanceQuery } from '../../../../app/service/reporting/contracts'

describe('reporting contracts', () => {
  it('bounds performance queries and returns a half-open range', () => {
    const now = new Date('2026-09-12T12:00:00.000Z')
    const query = parsePerformanceQuery({ from: '2026-09-11T00:00:00.000Z', to: '2026-09-12T00:00:00.000Z', metric: 'LCP' }, now)
    assert.equal(query.metric, 'LCP')
    assert.throws(() => parsePerformanceQuery({ from: '2026-01-01T00:00:00Z', to: '2026-09-12T00:00:00Z' }, now), /range/)
  })
  it('requires a metric and exact route page key for a page performance detail', () => {
    const now = new Date('2026-09-12T12:00:00.000Z')
    const query = parsePerformanceDetailQuery({ from: '2026-09-11T00:00:00.000Z', to: '2026-09-12T00:00:00.000Z', metric: 'INP' }, '/checkout/:id', now)
    assert.equal(query.pageKey, '/checkout/:id')
    assert.equal(query.metric, 'INP')
    assert.throws(() => parsePerformanceDetailQuery({ metric: 'INP', page_key: '/another' }, '/checkout/:id', now), /page key/)
    assert.throws(() => parsePerformanceDetailQuery({}, '/checkout/:id', now), /metric/)
  })
  it('does not allow raw data export definitions or spreadsheet formulas', () => {
    const request = parseExportRequest({ format: 'csv', definition: { schema_version: 1, kind: 'trend', subject_kind: 'visitor', from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', timezone: 'UTC', granularity: 'day', event_names: [ 'page_view' ] } })
    assert.equal(request.queryHash.length, 32)
    assert.equal(escapeCsvCell('=SUM(A1:A2)'), "'=SUM(A1:A2)")
    assert.throws(() => parseExportRequest({ format: 'pdf', definition: {} }), /format/)
    assert.throws(() => parseExportRequest({ format: 'csv', definition: { kind: 'events' } }), /invalid/)
  })
})
