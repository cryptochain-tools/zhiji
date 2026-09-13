import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { DEFAULT_DATA_LIFECYCLE_POLICY, effectiveDataLifecyclePolicy, legacyDataLifecyclePolicy, parseDataLifecyclePolicy } from '../../../../app/service/lifecycle/policy'

describe('data lifecycle policy', () => {
  it('requires every named retention category and applies non-expandable raw-data caps', () => {
    assert.equal(parseDataLifecyclePolicy({ raw_event_days: 1 }), null)
    const configured = { ...DEFAULT_DATA_LIFECYCLE_POLICY, replay_raw_days: 999, behavior_raw_days: 15, aggregate_days: 2_000 }
    assert.deepEqual(effectiveDataLifecyclePolicy(parseDataLifecyclePolicy(configured)), { ...configured, replay_raw_days: 7, behavior_raw_days: 14 })
  })
  it('maps legacy retention to raw/aggregate values without lengthening independent retention', () => {
    assert.deepEqual(legacyDataLifecyclePolicy(365).replay_raw_days, 7)
    assert.deepEqual(legacyDataLifecyclePolicy(365).aggregate_days, 365)
  })
})
