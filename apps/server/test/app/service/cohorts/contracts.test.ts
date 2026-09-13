import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { parseCohortInput, parsePreview, snapshotRange } from '../../../../app/service/cohorts/contracts'
describe('cohort contracts', () => {
  const definition = { schema_version: 1, event_name: 'purchase', min_occurrences: 1, max_occurrences: 3, window: { kind: 'relative', days: 30 }, property_filters: [{ key: 'plan', value: 'pro' }] }
  it('accepts a bounded dynamic event definition', () => {
    const input = parseCohortInput({ name: 'Paid', visibility: 'project', subject_kind: 'business_user', definition })
    assert.equal(input.definition.event_name, 'purchase'); assert.equal(input.subjectKind, 'business_user')
    const range = snapshotRange(input.definition, new Date('2026-09-12T00:00:00Z'))
    assert.equal(range.from.toISOString(), '2026-08-13T00:00:00.000Z')
  })
  it('rejects member lists, too many properties, and unbounded dates', () => {
    assert.throws(() => parseCohortInput({ name: 'Bad', visibility: 'project', subject_kind: 'visitor', members: [ 'x' ], definition }))
    assert.throws(() => parseCohortInput({ name: 'Bad', visibility: 'project', subject_kind: 'visitor', definition: { ...definition, property_filters: Array.from({ length: 6 }, (_, index) => ({ key: `x${index}`, value: true })) } }))
    assert.throws(() => parsePreview({ as_of: '2020-01-01T00:00:00Z' }, new Date('2026-09-12T00:00:00Z')))
  })
})
