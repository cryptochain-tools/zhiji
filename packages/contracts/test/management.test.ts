import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_DATA_LIFECYCLE_POLICY, effectiveDataLifecyclePolicy, parseDataLifecyclePolicy } from '../src/index'

test('lifecycle policy accepts the complete wire contract only', () => {
  assert.deepEqual(parseDataLifecyclePolicy(DEFAULT_DATA_LIFECYCLE_POLICY), DEFAULT_DATA_LIFECYCLE_POLICY)
  assert.equal(parseDataLifecyclePolicy({ raw_event_days: 1 }), null)
  assert.equal(parseDataLifecyclePolicy({ ...DEFAULT_DATA_LIFECYCLE_POLICY, ignored: 1 }), null)
})

test('effective lifecycle policy applies fixed privacy caps', () => {
  const configured = { ...DEFAULT_DATA_LIFECYCLE_POLICY, replay_raw_days: 100, behavior_raw_days: 20 }
  assert.deepEqual(effectiveDataLifecyclePolicy(configured), { ...configured, replay_raw_days: 7, behavior_raw_days: 14 })
})
