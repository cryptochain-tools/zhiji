import assert from 'node:assert/strict'
import { parseFunnelQuery } from '../../../../app/service/funnel/contracts'

describe('funnel contract', () => {
  const scope = { tenantId: 'tenant', projectId: 'project' }
  const now = new Date('2026-09-12T12:00:00.000Z')
  const valid = { from: '2026-09-10T00:00:00Z', to: '2026-09-12T00:00:00Z', steps: [ 'page_view', 'signup', 'purchase' ], subject_kind: 'visitor' }

  it('requires 2-5 ordered steps, a bounded half-open range, and explicit subject kind', () => {
    const query = parseFunnelQuery(scope, valid, now)
    assert.deepEqual(query.steps, [ 'page_view', 'signup', 'purchase' ])
    assert.equal(query.subjectKind, 'visitor')
    assert.throws(() => parseFunnelQuery(scope, { ...valid, steps: [ 'page_view' ] }, now), { code: 'invalid_funnel_query' })
    assert.throws(() => parseFunnelQuery(scope, { ...valid, steps: [ 'a', 'b', 'c', 'd', 'e', 'f' ] }, now), { code: 'invalid_funnel_query' })
    assert.throws(() => parseFunnelQuery(scope, { ...valid, from: '2026-01-01T00:00:00Z' }, now), { code: 'invalid_funnel_query' })
    assert.throws(() => parseFunnelQuery(scope, { ...valid, subject_kind: undefined }, now), { code: 'invalid_funnel_query' })
  })

  it('keeps repeated names because each needs an independent later event', () => {
    const query = parseFunnelQuery(scope, { ...valid, steps: [ 'view', 'view' ], subject_kind: 'business_user' }, now)
    assert.deepEqual(query.steps, [ 'view', 'view' ])
    assert.equal(query.subjectKind, 'business_user')
  })
})
