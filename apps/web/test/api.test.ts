import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiClient, rangeQuery, scoped, usageRangeQuery } from '../src/api'

test('scoped API paths encode identifiers', () => {
  assert.equal(scoped('tenant/a', 'project b', '/errors'), '/api/tenants/tenant%2Fa/projects/project%20b/errors')
})

test('trend range carries bounded ISO dates and granularity', () => {
  const query = rangeQuery(7, 'day')
  assert.equal(query.get('granularity'), 'day')
  assert.ok(Date.parse(query.get('from') ?? '') < Date.parse(query.get('to') ?? ''))
})

test('usage range uses UTC calendar-day boundaries', () => {
  const query = usageRangeQuery(30, 'error')
  assert.equal(query.get('lane'), 'error')
  assert.match(query.get('from') ?? '', /T00:00:00\.000Z$/)
  assert.match(query.get('to') ?? '', /T00:00:00\.000Z$/)
  assert.equal(Date.parse(query.get('to') ?? '') - Date.parse(query.get('from') ?? ''), 30 * 86_400_000)
})

test('user directory and journey remain project-scoped and encode the business user identifier', async () => {
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async input => {
    calls.push(String(input))
    const data = calls.length === 1 ? { items: [] } : { profile: {}, from: '', to: '', items: [], has_more: false }
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const client = new ApiClient('https://api.example.test')
    await client.people('tenant/a', 'project b', new URLSearchParams({ search: '林', limit: '25' }))
    await client.userJourney('tenant/a', 'project b', 'user/42', new URLSearchParams({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', limit: '100' }))
    assert.deepEqual(calls, [
      'https://api.example.test/api/tenants/tenant%2Fa/projects/project%20b/people?search=%E6%9E%97&limit=25',
      'https://api.example.test/api/tenants/tenant%2Fa/projects/project%20b/people/user%2F42/journey?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-02T00%3A00%3A00.000Z&limit=100',
    ])
  } finally { globalThis.fetch = originalFetch }
})

test('replay list keeps bounded filters and cursor in the project-scoped request', async () => {
  const originalFetch = globalThis.fetch
  let requested = ''
  globalThis.fetch = async input => {
    requested = String(input)
    return new Response(JSON.stringify({ data: { items: [], next_cursor: null } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const query = new URLSearchParams({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', route: '/checkout', release: 'web 1', visitor_id: 'visitor/a', limit: '50', cursor: 'next page' })
    await new ApiClient('https://api.example.test').replays('tenant/a', 'project b', query)
    assert.equal(requested, 'https://api.example.test/api/tenants/tenant%2Fa/projects/project%20b/replays?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-02T00%3A00%3A00.000Z&route=%2Fcheckout&release=web+1&visitor_id=visitor%2Fa&limit=50&cursor=next+page')
  } finally { globalThis.fetch = originalFetch }
})

test('tenant lifecycle defaults use the tenant-scoped settings endpoint', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; method: string; body: string }> = []
  const policy = { raw_event_days: 90, error_occurrence_days: 90, behavior_raw_days: 14, replay_raw_days: 7, performance_raw_days: 30, aggregate_days: 90, backup_expiry_days: 30 }
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ data: { tenant: { id: 'tenant/a', retention_days: 90, event_quota: 1000, data_lifecycle_policy: policy } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const client = new ApiClient('https://api.example.test')
    await client.tenantDefaults('tenant/a')
    await client.updateTenantDefaults('tenant/a', { retention_days: 90, event_quota: 1000, data_lifecycle_policy: policy })
    assert.equal(calls[0]?.url, 'https://api.example.test/api/tenants/tenant%2Fa/settings')
    assert.equal(calls[0]?.method, 'GET')
    assert.equal(calls[1]?.method, 'PATCH')
    assert.equal(calls[1]?.body, JSON.stringify({ retention_days: 90, event_quota: 1000, data_lifecycle_policy: policy }))
  } finally { globalThis.fetch = originalFetch }
})

test('direct member creation is tenant-scoped and sends only account fields', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; method: string; body: string }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ data: { member: { user_id: 'user-1', email: 'new@example.com', display_name: 'New member', role: 'member' }, existing_user: false, initial_password: 'generated-password' } }), { status: 201, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await new ApiClient('https://api.example.test').createDirectMember('tenant/a', { email: 'new@example.com', display_name: 'New member', role: 'member' })
    assert.equal(calls[0]?.url, 'https://api.example.test/api/tenants/tenant%2Fa/members/direct')
    assert.equal(calls[0]?.method, 'POST')
    assert.equal(calls[0]?.body, '{"email":"new@example.com","display_name":"New member","role":"member"}')
    assert.equal(result.initial_password, 'generated-password')
  } finally { globalThis.fetch = originalFetch }
})

test('member project access uses tenant-scoped list and explicit replacement', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; method: string; body: string }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ data: calls.length === 1 ? { items: [] } : { user_id: 'user/1', project_ids: [ 'project-1' ] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const client = new ApiClient('https://api.example.test')
    await client.members('tenant/a')
    await client.updateMemberProjects('tenant/a', 'user/1', [ 'project-1' ])
    assert.deepEqual(calls, [
      { url: 'https://api.example.test/api/tenants/tenant%2Fa/members', method: 'GET', body: '' },
      { url: 'https://api.example.test/api/tenants/tenant%2Fa/members/user%2F1/projects', method: 'PUT', body: '{"project_ids":["project-1"]}' },
    ])
  } finally { globalThis.fetch = originalFetch }
})

test('audit log requests stay tenant-scoped and use caller-provided bounded query values', async () => {
  const originalFetch = globalThis.fetch
  let requested = ''
  globalThis.fetch = async input => {
    requested = String(input)
    return new Response(JSON.stringify({ data: { items: [], next_cursor: null } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const query = new URLSearchParams({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', action: 'project_key_disabled', limit: '50' })
    await new ApiClient('https://api.example.test').auditLogs('tenant/a', query)
    assert.equal(requested, 'https://api.example.test/api/tenants/tenant%2Fa/audit-logs?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-02T00%3A00%3A00.000Z&action=project_key_disabled&limit=50')
  } finally { globalThis.fetch = originalFetch }
})

test('Source Map inventory remains project-scoped and never requests map content or keys', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; method: string; body: string }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ data: { items: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    await new ApiClient('https://api.example.test').sourceMaps('tenant/a', 'project b')
    assert.equal(calls[0]?.url, 'https://api.example.test/api/tenants/tenant%2Fa/projects/project%20b/sourcemaps')
    assert.equal(calls[0]?.method, 'GET')
    assert.doesNotMatch(calls[0]?.body ?? '', /map|source|key/i)
  } finally { globalThis.fetch = originalFetch }
})

test('saved insight and schedule calls remain project-scoped and carry optimistic versions', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; method: string; body: string }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ data: { archived: true } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const api = new ApiClient('https://api.example.test')
    await api.archiveInsight('tenant/a', 'project b', '00000000-0000-4000-8000-000000000001', 3)
    await api.disableReportSchedule('tenant/a', 'project b', '00000000-0000-4000-8000-000000000002', '2026-09-12T00:00:00.000Z')
    assert.equal(calls[0]?.url, 'https://api.example.test/api/tenants/tenant%2Fa/projects/project%20b/insights/00000000-0000-4000-8000-000000000001')
    assert.equal(calls[0]?.method, 'DELETE')
    assert.equal(calls[0]?.body, '{"expected_definition_version":3}')
    assert.equal(calls[1]?.method, 'DELETE')
    assert.equal(calls[1]?.body, '{"expected_updated_at":"2026-09-12T00:00:00.000Z"}')
  } finally { globalThis.fetch = originalFetch }
})

test('cohort and analytics export calls are project-scoped; download token is only used for the follow-up request', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; method: string; body: string }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') })
    if (url.endsWith('/lifecycle-proofs')) return new Response(JSON.stringify({ data: { proof: 'p'.repeat(43), expires_at: '2026-09-13T06:10:00.000Z' } }), { status: 201, headers: { 'content-type': 'application/json' } })
    if (url.includes('/download') && !url.includes('token=')) return new Response(JSON.stringify({ data: { token: 'a'.repeat(32), expires_in_seconds: 900 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.includes('token=')) return new Response('event,count\npage_view,3\n', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } })
    return new Response(JSON.stringify({ data: { id: '00000000-0000-4000-8000-000000000001' } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const client = new ApiClient('https://api.example.test')
    await client.previewCohort('tenant/a', 'project b', '00000000-0000-4000-8000-000000000001')
    await client.createAnalyticsExport('tenant/a', 'project b', { format: 'csv', target: { type: 'insight', id: '00000000-0000-4000-8000-000000000002' } })
    const file = await client.downloadAnalyticsExport('tenant/a', 'project b', '00000000-0000-4000-8000-000000000003')
    assert.equal(file.format, 'csv')
    assert.equal(calls[0]?.url, 'https://api.example.test/api/tenants/tenant%2Fa/projects/project%20b/cohorts/00000000-0000-4000-8000-000000000001/preview')
    assert.equal(calls[0]?.method, 'POST')
    assert.equal(calls[1]?.url, 'https://api.example.test/api/tenants/tenant%2Fa/projects/project%20b/analytics-exports')
    assert.match(calls[1]?.body ?? '', /"format":"csv"/)
    assert.equal(calls[2]?.url, 'https://api.example.test/api/tenants/tenant%2Fa/projects/project%20b/analytics-exports/00000000-0000-4000-8000-000000000003/download')
    assert.match(calls[3]?.url ?? '', /\/download\?token=/)
  } finally { globalThis.fetch = originalFetch }
})

test('subject lifecycle calls remain project-scoped; export token is used only for a one-time download', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; method: string; body: string }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') })
    if (url.includes('/download') && !url.includes('token=')) return new Response(JSON.stringify({ data: { token: 'b'.repeat(32), expires_in_seconds: 900 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.includes('token=')) return new Response('{"schema_version":1}', { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ data: { items: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const client = new ApiClient('https://api.example.test')
    await client.subjectExports('tenant/a', 'project b')
    await client.issueLifecycleProof('tenant/a', 'project b', { operation: 'subject_export', subject_business_user_id: 'account-42', purpose: 'request copy', password: 'current-password' })
    await client.requestSubjectExport('tenant/a', 'project b', { subject_business_user_id: 'account-42', purpose: 'request copy', proof: 'opaque-proof' })
    await client.downloadSubjectExport('tenant/a', 'project b', '00000000-0000-4000-8000-000000000003')
    assert.equal(calls[0]?.url, 'https://api.example.test/api/tenants/tenant%2Fa/projects/project%20b/data-exports')
    assert.equal(calls[0]?.method, 'GET')
    assert.equal(calls[1]?.url, 'https://api.example.test/api/tenants/tenant%2Fa/projects/project%20b/lifecycle-proofs')
    assert.equal(calls[1]?.method, 'POST')
    assert.match(calls[1]?.body ?? '', /current-password/)
    assert.equal(calls[2]?.method, 'POST')
    assert.doesNotMatch(calls[2]?.body ?? '', /token|artifact_ref|path/i)
    assert.equal(calls[3]?.method, 'GET')
    assert.match(calls[4]?.url ?? '', /\/data-exports\/00000000-0000-4000-8000-000000000003\/download\?token=/)
  } finally { globalThis.fetch = originalFetch }
})

test('tenant subscription and adjustment calls stay tenant-scoped and never contain payment details', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; method: string; body: string }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ data: { subscription: null } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const client = new ApiClient('https://api.example.test')
    await client.usageSubscription('tenant/a')
    await client.updateUsageSubscription('tenant/a', { hard_limit_enabled: true, grace_percent: 20 })
    await client.adjustUsage('tenant/a', { lane: 'analytics', delta_events: -25, delta_bytes: 0, reason: 'correct duplicate receipt' })
    assert.equal(calls[0]?.url, 'https://api.example.test/api/tenants/tenant%2Fa/usage')
    assert.equal(calls[0]?.method, 'GET')
    assert.equal(calls[1]?.url, 'https://api.example.test/api/tenants/tenant%2Fa/subscription')
    assert.equal(calls[1]?.method, 'PATCH')
    assert.equal(calls[1]?.body, '{"hard_limit_enabled":true,"grace_percent":20}')
    assert.equal(calls[2]?.url, 'https://api.example.test/api/tenants/tenant%2Fa/usage-adjustments')
    assert.equal(calls[2]?.method, 'POST')
    assert.equal(calls[2]?.body, '{"lane":"analytics","delta_events":-25,"delta_bytes":0,"reason":"correct duplicate receipt"}')
  } finally { globalThis.fetch = originalFetch }
})

test('alert management calls are project-scoped, versioned, and never send transport configuration', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; method: string; body: string }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ data: { items: [], next_cursor: null } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const client = new ApiClient('https://api.example.test')
    const tenantId = 'tenant/a'; const projectId = 'project b'; const id = '00000000-0000-4000-8000-000000000001'; const version = '2026-09-12T00:00:00.000Z'
    await client.updateAlertTarget(tenantId, projectId, id, { expected_updated_at: version, label: 'production incidents', enabled: false })
    await client.disableAlertTarget(tenantId, projectId, id, version)
    await client.updateAlertRule(tenantId, projectId, id, { expected_updated_at: version, name: 'slow LCP', condition: { threshold: 2500, window_seconds: 900, minimum_samples: 100 }, target_ids: [id], enabled: true })
    await client.disableAlertRule(tenantId, projectId, id, version)
    await client.alertInstances(tenantId, projectId, new URLSearchParams({ limit: '50' }))
    await client.alertDeliveries(tenantId, projectId, new URLSearchParams({ limit: '50' }))
    for (const call of calls) {
      assert.match(call.url, /\/api\/tenants\/tenant%2Fa\/projects\/project%20b\/alerts\//)
      assert.doesNotMatch(call.body, /endpoint|url|secret|token|email|webhook/i)
    }
    assert.equal(calls[0]?.method, 'PATCH')
    assert.equal(calls[1]?.method, 'DELETE')
    assert.equal(calls[2]?.method, 'PATCH')
    assert.equal(calls[3]?.method, 'DELETE')
    assert.match(calls[4]?.url ?? '', /\/alerts\/instances\?limit=50$/)
    assert.match(calls[5]?.url ?? '', /\/alerts\/deliveries\?limit=50$/)
  } finally { globalThis.fetch = originalFetch }
})

test('performance detail request is scoped to an encoded page key and carries only bounded query fields', async () => {
  const originalFetch = globalThis.fetch
  let requested = ''
  globalThis.fetch = async input => {
    requested = String(input)
    return new Response(JSON.stringify({ data: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', page_key: '/checkout/:id', metric: 'LCP', points: [], page_versions: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const query = new URLSearchParams({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', metric: 'LCP' })
    await new ApiClient('https://api.example.test').performanceDetail('tenant/a', 'project b', '/checkout/:id', query)
    assert.equal(requested, 'https://api.example.test/api/tenants/tenant%2Fa/projects/project%20b/performance/pages/%2Fcheckout%2F%3Aid?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-02T00%3A00%3A00.000Z&metric=LCP')
    assert.doesNotMatch(requested, /visitor|business_user|route/i)
  } finally { globalThis.fetch = originalFetch }
})

test('project dashboard and event explorer stay scoped and never request raw facts', async () => {
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async input => { calls.push(String(input)); return new Response(JSON.stringify({ data: { summary: {}, items: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }) }
  try {
    const client = new ApiClient('https://api.example.test'); const query = new URLSearchParams({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', granularity: 'day' })
    await client.projectDashboard('tenant/a', 'project b', query)
    await client.eventExplorer('tenant/a', 'project b', new URLSearchParams({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z', group_by: 'name' }))
    assert.match(calls[0]!, /\/api\/tenants\/tenant%2Fa\/projects\/project%20b\/dashboard\?/)
    assert.match(calls[1]!, /\/api\/tenants\/tenant%2Fa\/projects\/project%20b\/events\?/)
    assert.doesNotMatch(calls.join('\n'), /visitor_id|business_user_id|raw/i)
  } finally { globalThis.fetch = originalFetch }
})

test('cancelled console requests do not become network errors', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  controller.abort()
  globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError') }
  try {
    await assert.rejects(new ApiClient().me(controller.signal), error => error instanceof DOMException && error.name === 'AbortError')
  } finally { globalThis.fetch = originalFetch }
})

test('real network failures retain a useful error message', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  try {
    await assert.rejects(new ApiClient().me(), { code: 'network_error', status: 0 })
  } finally { globalThis.fetch = originalFetch }
})
