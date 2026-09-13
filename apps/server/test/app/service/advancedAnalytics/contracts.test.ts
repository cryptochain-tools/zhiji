import assert from 'node:assert/strict'
import { parsePathQuery, parseRetentionQuery } from '../../../../app/service/advancedAnalytics/contracts'

const scope = { tenantId: 'tenant', projectId: 'project' }
const now = new Date('2026-09-12T12:00:00.000Z')

describe('advanced analytics contracts', () => {
  it('bounds retention periods, query ranges, identity unit and IANA-like timezone', () => {
    const query = parseRetentionQuery(scope, { from: '2026-09-01T00:00:00Z', to: '2026-09-12T00:00:00Z', start_event: 'signup', return_event: 'page_view', period: 'week', period_count: '4', subject_kind: 'business_user', timezone: 'Asia/Shanghai' }, now)
    assert.equal(query.periodCount, 4)
    assert.equal(query.subjectKind, 'business_user')
    assert.throws(() => parseRetentionQuery(scope, { ...query, period_count: 13 }, now), { code: 'invalid_retention_query' })
    assert.throws(() => parseRetentionQuery(scope, { ...query, period_count: '4.5' }, now), { code: 'invalid_retention_query' })
    assert.throws(() => parseRetentionQuery(scope, { ...query, timezone: "UTC'; select 1" }, now), { code: 'invalid_retention_query' })
  })
  it('requires a bounded 2-5 depth path and named start event', () => {
    const query = parsePathQuery(scope, { from: '2026-09-01T00:00:00Z', to: '2026-09-12T00:00:00Z', start_event: 'page_view', depth: '3', subject_kind: 'visitor' }, now)
    assert.equal(query.depth, 3)
    assert.throws(() => parsePathQuery(scope, { ...query, depth: 6 }, now), { code: 'invalid_path_query' })
    assert.throws(() => parsePathQuery(scope, { ...query, depth: '3e0' }, now), { code: 'invalid_path_query' })
    assert.throws(() => parsePathQuery(scope, { ...query, from: '2026-01-01T00:00:00Z' }, now), { code: 'invalid_path_query' })
  })
})
