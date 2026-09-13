import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { replayPolicy } from '../../app'

describe('public SDK replay policy', () => {
  it('fails closed without invalidating the rest of SDK configuration', () => {
    assert.deepEqual(replayPolicy({
      enabled: true,
      policy_version: 2,
      sample_rate: 0,
      page_allowlist: [],
      max_session_seconds: 0,
      max_session_bytes: 0,
    }), {
      enabled: false,
      policy_version: 2,
      sample_rate: 0,
      page_allowlist: [],
      max_session_seconds: 0,
      max_session_bytes: 0,
    })
  })

  it('preserves a complete enabled replay policy', () => {
    assert.deepEqual(replayPolicy({
      enabled: true,
      policy_version: 3,
      sample_rate: 0.25,
      page_allowlist: [ '/checkout/:id' ],
      max_session_seconds: 600,
      max_session_bytes: 1_000_000,
    }), {
      enabled: true,
      policy_version: 3,
      sample_rate: 0.25,
      page_allowlist: [ '/checkout/:id' ],
      max_session_seconds: 600,
      max_session_bytes: 1_000_000,
    })
  })
})
