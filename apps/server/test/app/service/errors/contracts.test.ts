import assert from 'node:assert/strict'
import { automaticStatusAfterOccurrence, parseErrorStatePatch } from '../../../../app/service/errors/contracts'

describe('error contracts', () => {
  it('only accepts the documented optimistic patch shape', () => {
    assert.deepEqual(parseErrorStatePatch({ status: 'resolved', expected_state_version: 7, reason: ' fixed ' }), { status: 'resolved', expected_state_version: 7, reason: 'fixed' })
    assert.equal(parseErrorStatePatch({ status: 'resolved', expected_state_version: 7, extra: true }), null)
    assert.equal(parseErrorStatePatch({ status: 'resolved', expected_state_version: -1 }), null)
  })

  it('only auto-regresses a resolved group for a strictly newer occurrence', () => {
    const resolved = new Date('2026-09-12T00:00:00.000Z')
    assert.equal(automaticStatusAfterOccurrence({ group_id: 'g', status: 'resolved', resolved_at: resolved, state_version: 1 }, resolved), 'resolved')
    assert.equal(automaticStatusAfterOccurrence({ group_id: 'g', status: 'resolved', resolved_at: resolved, state_version: 1 }, new Date('2026-09-12T00:00:00.001Z')), 'unresolved')
    assert.equal(automaticStatusAfterOccurrence({ group_id: 'g', status: 'ignored', resolved_at: null, state_version: 1 }, new Date()), 'ignored')
  })
})
