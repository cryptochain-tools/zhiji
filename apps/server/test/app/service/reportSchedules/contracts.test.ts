import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { parseCreateSchedule, parsePatchSchedule, parseScheduleListQuery } from '../../../../app/service/reportSchedules/contracts'

const id = '20000000-0000-4000-8000-000000000001'
const now = new Date('2026-09-12T00:00:00.000Z')
const valid = { target_type: 'insight', target_id: id, cadence: 'weekly', timezone: 'Asia/Shanghai', next_run_at: '2026-09-13T00:00:00.000Z', notification_target_id: id }

describe('report schedule contracts', () => {
  it('bounds a safe schedule and defaults it disabled', () => {
    assert.deepEqual(parseCreateSchedule(valid, now), { targetType: 'insight', targetId: id, cadence: 'weekly', timezone: 'Asia/Shanghai', nextRunAt: new Date(valid.next_run_at), enabled: false, notificationTargetId: id })
  })
  it('requires a complete target pair and optimistic update marker', () => {
    assert.throws(() => parsePatchSchedule({ expected_updated_at: now.toISOString(), target_type: 'dashboard' }, now), (error: Error & { code?: string }) => error.code === 'invalid_report_schedule')
    assert.throws(() => parsePatchSchedule({ enabled: true }, now), (error: Error & { code?: string }) => error.code === 'invalid_report_schedule')
  })
  it('rejects invalid timezones, stale runs and malformed cursor', () => {
    assert.throws(() => parseCreateSchedule({ ...valid, timezone: 'not/a-timezone' }, now), (error: Error & { code?: string }) => error.code === 'invalid_report_schedule')
    assert.throws(() => parseCreateSchedule({ ...valid, next_run_at: now.toISOString() }, now), (error: Error & { code?: string }) => error.code === 'invalid_report_schedule')
    assert.throws(() => parseScheduleListQuery({ cursor: 'bogus' }), (error: Error & { code?: string }) => error.code === 'invalid_report_schedule_query')
    assert.throws(() => parseCreateSchedule({ ...valid, webhook_url: 'https://example.test/private' }, now), (error: Error & { code?: string }) => error.code === 'invalid_report_schedule')
  })
})
