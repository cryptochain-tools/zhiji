import assert from 'node:assert/strict'
import { alertCursorFor, parseAlertListQuery, parseRuleInput, parseTargetInput, scrubAlertSummary } from '../../../../app/service/alerts/contracts'

describe('alert contracts', () => {
  it('bounds opaque management cursors and page sizes', () => {
    const cursor = alertCursorFor(new Date('2026-09-12T00:00:00.000Z'), '20000000-0000-4000-8000-000000000001')
    const query = parseAlertListQuery({ cursor, limit: '2' })
    assert.equal(query.limit, 2)
    assert.equal(query.cursor?.createdAt.toISOString(), '2026-09-12T00:00:00.000Z')
    assert.throws(() => parseAlertListQuery({ limit: '101' }), (error: Error & { code?: string }) => error.code === 'invalid_alert_query')
    assert.throws(() => parseAlertListQuery({ cursor: 'invalid' }), (error: Error & { code?: string }) => error.code === 'invalid_alert_cursor')
  })
  it('accepts only bounded rule conditions and deduplicates target ids', () => {
    const target = '01d53000-0000-4000-8000-000000000001'
    const result = parseRuleInput({ name: 'Error threshold', rule_type: 'error_count', condition: { window_seconds: 900, threshold: 3 }, target_ids: [ target, target ] })
    assert.deepEqual(result.targetIds, [ target ])
    assert.throws(() => parseRuleInput({ name: 'bad', rule_type: 'error_count', condition: { window_seconds: 7, threshold: 3 }, target_ids: [ target ] }), /Alert condition/)
  })
  it('fails closed for target endpoint and secret input while transport is disabled', () => {
    assert.throws(() => parseTargetInput({ type: 'webhook', label: 'Ops', url: 'https://example.test/hook' }), (error: Error & { code?: string }) => error.code === 'invalid_alert_input')
    assert.deepEqual(parseTargetInput({ type: 'email', label: 'Team mail' }), { type: 'email', label: 'Team mail', configPublic: {} })
  })
  it('scrubs all unknown and potentially sensitive fields', () => {
    assert.deepEqual(scrubAlertSummary({ count: 8, stack: 'secret', url: 'https://secret', visitor_id: 'v', release: 'v1' }), { count: 8, release: 'v1' })
  })
})
