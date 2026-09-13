#!/usr/bin/env node
/**
 * Local-only, read-only fixture API for manually reviewing the console.
 * Every value below is synthetic. It never connects to a database or accepts
 * writes. Start it with: node apps/web/test/fixtures/console-api.mjs
 */
import http from 'node:http'

const host = '127.0.0.1'
const port = 5175
const now = new Date('2026-09-12T12:00:00.000Z')
const iso = (days = 0, hours = 0) => new Date(now.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString()
const lifecycle = { raw_event_days: 30, error_occurrence_days: 30, behavior_raw_days: 14, replay_raw_days: 7, performance_raw_days: 30, aggregate_days: 365, backup_expiry_days: 14 }
const tenant = { id: 'fixture-tenant', name: '示例工作空间', role: 'owner' }
const project = {
  id: 'fixture-project', name: '知迹官网', allowed_origins: ['https://zhiji.example.test'], core_event_names: ['signup', 'checkout_complete'],
  page_capture: { allowed_page_keys: ['/', '/pricing', '/signup'], route_templates: ['/docs/:slug'] }, mobile_applications: [],
  policy: { retention_days: { configured: null, effective: 30, source: 'tenant_default' }, data_lifecycle_policy: { configured: null, effective: lifecycle, source: 'tenant_default' }, event_quota: { configured: null, effective: 100000, source: 'tenant_default' }, enforcement_enabled: false },
  behavior_capture: { enabled: true, policy_version: 3, page_allowlist: ['/'], track_ids: ['signup-submit'], block_selectors: ['[data-private]'], sample_rate: 1 },
  session_replay: { enabled: true, policy_version: 2 }, performance_capture: { enabled: true, policy_version: 1 }, created_at: iso(-90),
}
// Extra synthetic projects let the console review project switching without
// creating or changing anything in a real tenant.
const emptyProject = {
  ...project, id: 'project-empty', name: '新项目（未接入）', allowed_origins: [], core_event_names: [],
  page_capture: { allowed_page_keys: [], route_templates: [] }, behavior_capture: { ...project.behavior_capture, enabled: false },
  session_replay: { ...project.session_replay, enabled: false }, performance_capture: { ...project.performance_capture, enabled: false }, created_at: iso(-1),
}
const forbiddenProject = { ...project, id: 'project-forbidden', name: '权限不足（本地模拟）' }
const errorProject = { ...project, id: 'project-error', name: '服务异常（本地模拟）' }
const projects = [project, emptyProject, forbiddenProject, errorProject]
const insight = { id: 'insight-signup', name: '注册转化', description: '示例数据，仅用于本地视觉验收。', kind: 'funnel', visibility: 'project', definition_version: 1, created_by: 'fixture-owner', updated_by: 'fixture-owner', created_at: iso(-10), updated_at: iso(-1), definition: { schema_version: 1, kind: 'funnel', subject_kind: 'visitor', from: iso(-30), to: iso(), timezone: 'Asia/Shanghai', steps: ['page_view', 'signup'] } }
const dashboard = { id: 'dashboard-growth', name: '增长概览', description: '本地合成仪表盘。', visibility: 'project', version: 1, created_by: 'fixture-owner', updated_by: 'fixture-owner', created_at: iso(-9), updated_at: iso(-1) }
const errorGroup = { id: 'error-checkout', status: 'unresolved', type: 'TypeError', display_message: 'Cannot read properties of undefined', release: 'web-2026.09.12', first_seen: iso(-3), last_seen: iso(-1), occurrence_count: 42, resolved_at: null, state_version: 2 }
const people = [
  { business_user_id: 'user_fixture_42', email: 'lin@example.test', display_name: '林澄', department: '招投标中心', role: '项目经理', is_active: true, last_seen_at: iso(0, -1), event_count: 38 },
  { business_user_id: 'user_fixture_77', email: 'zhou@example.test', display_name: '周岚', department: '经营管理部', role: '分析员', is_active: true, last_seen_at: iso(-1, 2), event_count: 16 },
]
const ok = (data) => ({ data, meta: { request_id: 'fixture-readonly' } })
const failure = (code, message) => ({ error: { code, message }, meta: { request_id: 'fixture-readonly' } })

function dataFor(path, query) {
  const scoped = new RegExp(`^/api/tenants/${tenant.id}/projects/([^/]+)`).exec(path)
  const projectId = scoped?.[1] ?? project.id
  const base = `/api/tenants/${tenant.id}/projects/${projectId}`
  if (path === '/api/auth/me') return { user_id: 'fixture-owner', tenants: [tenant] }
  if (path === `/api/tenants/${tenant.id}/members`) return { items: [
    { user_id: 'fixture-owner', email: 'owner@example.test', display_name: '租户所有者', role: 'owner', all_projects: true, project_ids: [] },
    { user_id: 'fixture-member', email: 'member@example.test', display_name: '产品成员', role: 'member', all_projects: false, project_ids: [project.id] },
    { user_id: 'fixture-viewer', email: 'viewer@example.test', display_name: '只读访客', role: 'viewer', all_projects: false, project_ids: [] },
  ] }
  if (path === `/api/tenants/${tenant.id}/projects`) return { items: projects }
  if (path === `/api/tenants/${tenant.id}/usage`) return { subscription: subscription() }
  if (path === `/api/tenants/${tenant.id}/settings`) return { tenant: { id: tenant.id, retention_days: 30, event_quota: 100000, data_lifecycle_policy: lifecycle } }
  if (path === `/api/tenants/${tenant.id}/audit-logs`) return { items: [{ id: 'audit-1', action: 'project_key_created', target_type: 'project_key', target_id: 'key-browser', actor_user_id: 'fixture-owner', created_at: iso(-1) }, { id: 'audit-2', action: 'alert_rule_created', target_type: 'alert_rule', target_id: 'rule-error', actor_user_id: 'fixture-owner', created_at: iso(-2) }], next_cursor: null }
  if (path === `/api/tenants/${tenant.id}/sso/connections`) return { connections: [{ id: 'sso-example', issuer: 'https://login.example.test', client_id: 'console-preview', allowed_email_domains: ['example.test'], default_role: 'member', enabled: true }] }
  if (projectId === emptyProject.id && path.startsWith(base)) return emptyProjectData(path.slice(base.length), query)
  if (path === `${base}/dashboard`) return { from: iso(-7), to: iso(), granularity: 'day', summary: { pv: 12480, visitors: 3210, business_users: 804, event_count: 21960, unresolved_errors: 1 }, core_event_series: [], error_top10: [{ id: errorGroup.id, title: 'TypeError: Cannot read properties of undefined', occurrence_count: 42, last_seen: iso(-1) }] }
  if (path === `${base}/analytics/trend`) return { from: iso(-7), to: iso(), granularity: 'day', points: trend() }
  if (path === `${base}/events`) return { from: iso(-7), to: iso(), group_by: query.get('group_by') ?? 'name', items: [{ value: 'page_view', count: 12480 }, { value: 'signup', count: 812 }, { value: 'checkout_complete', count: 386 }], truncated: false }
  if (path === `${base}/errors`) return { items: [errorGroup], next_cursor: null }
  if (path === `${base}/errors/${errorGroup.id}`) return { group: errorGroup, affected_visitor_count: 31, recent_occurrences: [{ id: 'occurrence-1', occurred_at: iso(-1), route: '/checkout', url: null, stack: 'TypeError: synthetic fixture stack', visitor_id: 'visitor-fixture-1', release: errorGroup.release }], history: [] }
  if (path === `${base}/performance`) return { from: iso(-7), to: iso(), items: performance() }
  if (path.startsWith(`${base}/performance/pages/`)) return performanceDetail(decodeURIComponent(path.slice(`${base}/performance/pages/`.length)), query.get('metric') ?? 'LCP')
  if (path === `${base}/heatmaps`) return { page_key: query.get('page_key') ?? '/', items: [{ id: 'heatmap-home', page_key: '/', page_version: 'web-2026.09.12', viewport_width_bucket: 1440, action: 'click', sample_count: 623, coverage_from: iso(-7), coverage_to: iso(), has_screenshot: false }] }
  if (path === `${base}/heatmaps/heatmap-home`) return { id: 'heatmap-home', page_key: '/', page_version: 'web-2026.09.12', viewport_width_bucket: 1440, action: 'click', grid_size: 24, bins: [{ x: 1, y: 2, count: 34 }, { x: 4, y: 5, count: 68 }, { x: 6, y: 1, count: 21 }], background: { available: false } }
  if (path === `${base}/replays`) return { items: [{ id: 'replay-1', visitor_id: 'visitor-fixture-1', business_user_id: null, started_at: iso(-1), release: 'web-2026.09.12', initial_route: '/', chunk_count: 1 }], next_cursor: null }
  if (path === `${base}/replays/replay-1/chunks`) return { items: [{ sequence_start: 0, sequence_end: 122, occurred_from: iso(-1), occurred_to: iso(-1, 1), timeline: { events: replayEvents() } }] }
  if (path === `${base}/funnel`) return funnel(query)
  if (path === `${base}/analytics/retention`) return retention(query)
  if (path === `${base}/analytics/path`) return pathAnalysis(query)
  if (path === `${base}/people`) return { items: people.filter(person => !query.get('search') || `${person.business_user_id} ${person.email} ${person.display_name}`.toLowerCase().includes(query.get('search').toLowerCase())) }
  if (path === `${base}/people/${people[0].business_user_id}/journey`) return userJourney(people[0])
  if (path === `${base}/people/${people[1].business_user_id}/journey`) return userJourney(people[1])
  if (path === `${base}/usage`) return { from: iso(-7), to: iso(), lane: query.get('lane') || null, totals: { received_events: 21960, received_bytes: 4839100 }, daily: usage() }
  if (path === `${base}/keys`) return { items: [{ id: 'key-browser', key_type: 'browser', label: '官网浏览器 Key', prefix: 'zj_bro_fixture', created_at: iso(-40), disabled_at: null }, { id: 'key-server', key_type: 'server', label: 'API 服务 Key', prefix: 'zj_srv_fixture', created_at: iso(-30), disabled_at: null }] }
  if (path === `${base}/insights`) return { items: [insight] }
  if (path === `${base}/dashboards`) return { items: [dashboard] }
  if (path === `${base}/dashboards/${dashboard.id}`) return { ...dashboard, tiles: [{ id: 'tile-1', saved_insight_id: insight.id, position: 0, width: 6, height: 3, title_override: null, tile_version: 1, insight: { name: insight.name, kind: insight.kind, definition: insight.definition } }] }
  if (path === `${base}/cohorts`) return { items: [{ id: 'cohort-active', name: '近 30 天注册用户', description: '用于本地展示。', subject_kind: 'visitor', definition_version: 1, visibility: 'project', created_by: 'fixture-owner', updated_by: 'fixture-owner', created_at: iso(-12), updated_at: iso(-2), definition: { schema_version: 1, event_name: 'signup', min_occurrences: 1, window: { kind: 'relative', days: 30 } } }] }
  if (path === `${base}/report-schedules`) return { items: [{ id: 'schedule-weekly', target_type: 'insight', target_id: insight.id, cadence: 'weekly', timezone: 'Asia/Shanghai', next_run_at: iso(3), enabled: true, notification_target_id: 'target-ops', created_by: 'fixture-owner', updated_by: 'fixture-owner', created_at: iso(-7), updated_at: iso(-1), latest_run: { id: 'run-1', status: 'completed', scheduled_for: iso(-4), finished_at: iso(-4, 1), error_code: null } }], next_cursor: null }
  if (path === `${base}/analytics-exports/export-1`) return { id: 'export-1', status: 'completed', format: 'csv', row_count: 12, byte_count: 2048, error_code: null, created_at: iso(-1), started_at: iso(-1), finished_at: iso(-1, 1), expires_at: iso(1) }
  if (path === `${base}/data-exports`) return { items: [{ id: 'subject-export-1', kind: 'subject_export', status: 'completed', subject_business_user_id: 'user_fixture_42', verification_method: 'fixture-proof', reauthenticated_at: iso(-1), created_at: iso(-1), started_at: iso(-1), finished_at: iso(-1, 1), expires_at: iso(1), reason_code: null, byte_count: 2048 }] }
  if (path === `${base}/deletions`) return { items: [{ id: 'subject-delete-1', kind: 'subject_deletion', status: 'queued', subject_business_user_id: 'user_fixture_99', verification_method: 'fixture-proof', reauthenticated_at: iso(-1), created_at: iso(-1), started_at: null, finished_at: null, expires_at: iso(14), reason_code: null, byte_count: null }] }
  if (path === `${base}/deletion`) return { deletion: { id: 'project-deletion-1', status: 'pending', effective_at: iso(7), created_at: iso(-1), cancelled_at: null, project_status: 'pending' } }
  if (path === `${base}/sourcemaps`) return { items: [{ id: 'map-1', release: 'web-2026.09.12', dist: 'main', artifact_path: 'assets/main.js', map_sha256: 'f'.repeat(64), source_count: 32, created_at: iso(-1), superseded_at: null }] }
  if (path === `${base}/alerts/targets`) return page([{ id: 'target-ops', type: 'lark_bot', label: '值班通知', enabled: true, verified_at: iso(-20), created_at: iso(-20), updated_at: iso(-1), disabled_at: null }])
  if (path === `${base}/alerts/rules`) return page([{ id: 'rule-error', name: '新错误告警', enabled: true, rule_type: 'error_new', condition: {}, target_ids: ['target-ops'], targets_version: 1, created_at: iso(-10), updated_at: iso(-1) }])
  if (path === `${base}/alerts/instances`) return page([{ id: 'alert-1', rule: { id: 'rule-error', name: '新错误告警', type: 'error_new' }, status: 'resolved', first_triggered_at: iso(-2), last_triggered_at: iso(-1), last_evaluated_at: iso(), cooldown_until: iso(1), summary: { occurrences: 42 } }])
  if (path === `${base}/alerts/deliveries`) return page([{ id: 'delivery-1', alert_instance_id: 'alert-1', target: { id: 'target-ops', type: 'lark_bot', label: '值班通知' }, status: 'delivered', attempt_count: 1, last_attempt_at: iso(-1), delivered_at: iso(-1), error_code: null, created_at: iso(-1) }])
  return null
}

const page = items => ({ items, next_cursor: null })
function emptyProjectData(suffix, query) {
  const common = { from: iso(-7), to: iso(), timezone: query.get('timezone') || 'Asia/Shanghai', subject_kind: query.get('subject_kind') || 'visitor', identity_attribution: 'all_linked', facts_deduplicated: true, source_event_count: 0, query_hash: 'fixture-empty', computed_at: iso(), truncated: false }
  if (suffix === '/dashboard') return { from: iso(-7), to: iso(), granularity: 'day', summary: { pv: 0, visitors: 0, business_users: 0, event_count: 0, unresolved_errors: 0 }, core_event_series: [], error_top10: [] }
  if (suffix === '/analytics/trend') return { from: iso(-7), to: iso(), granularity: 'day', points: [] }
  if (suffix === '/events') return { from: iso(-7), to: iso(), group_by: query.get('group_by') || 'name', items: [], truncated: false }
  if (suffix === '/replays') return { items: [], next_cursor: null }
  if (suffix === '/errors' || suffix === '/performance' || suffix === '/keys' || suffix === '/insights' || suffix === '/dashboards' || suffix === '/cohorts' || suffix === '/people' || suffix === '/data-exports' || suffix === '/deletions' || suffix === '/sourcemaps') return { items: [] }
  if (suffix === '/heatmaps') return { page_key: query.get('page_key') || '/', items: [] }
  if (suffix === '/funnel') return { ...common, timezone: 'UTC', steps: (query.get('steps') || 'page_view,signup').split(',').map(name => ({ name, count: 0, conversion: 0, dropoff: 0 })) }
  if (suffix === '/analytics/retention') return { ...common, kind: 'retention', period: query.get('period') || 'day', period_count: Number(query.get('period_count') || 7), start_event: query.get('start_event') || 'page_view', return_event: query.get('return_event') || 'page_view', cohorts: [] }
  if (suffix === '/analytics/path') return { ...common, kind: 'path', start_event: query.get('start_event') || 'page_view', depth: Number(query.get('depth') || 3), levels: [] }
  if (suffix === '/usage') return { from: iso(-7), to: iso(), lane: query.get('lane') || null, totals: { received_events: 0, received_bytes: 0 }, daily: [] }
  if (suffix === '/report-schedules' || suffix === '/alerts/targets' || suffix === '/alerts/rules' || suffix === '/alerts/instances' || suffix === '/alerts/deliveries') return page([])
  if (suffix === '/deletion') return { deletion: { id: 'fixture-empty-deletion', status: 'cancelled', effective_at: iso(7), created_at: iso(-1), cancelled_at: iso(), project_status: 'active' } }
  return null
}
const trend = () => Array.from({ length: 7 }, (_, index) => ({ bucket_start: iso(index - 6), event_name: index % 2 ? 'page_view' : 'signup', event_count: 800 + index * 41, page_views: 720 + index * 31, visitors: 240 + index * 12 }))
const performance = () => [{ metric_name: 'LCP', page_key: '/', release: 'web-2026.09.12', sample_count: 736, p50: 1620, p75: 2180, p95: 3320, good_count: 610, needs_improvement_count: 92, poor_count: 34 }, { metric_name: 'CLS', page_key: '/', release: 'web-2026.09.12', sample_count: 736, p50: .03, p75: .07, p95: .15, good_count: 650, needs_improvement_count: 60, poor_count: 26 }]
const performanceDetail = (page_key, metric) => ({ from: iso(-30), to: iso(), page_key, metric, page_versions: performance().filter(item => item.metric_name === metric), points: Array.from({ length: 6 }, (_, index) => ({ bucket_start: iso(index - 5), navigation_scope: index % 2 ? 'soft' : 'hard', release: 'web-2026.09.12', sample_count: 50 + index, p50: metric === 'CLS' ? .03 : 1500, p75: metric === 'CLS' ? .07 : 2180, p95: metric === 'CLS' ? .15 : 3320, good_count: 40 + index, needs_improvement_count: 7, poor_count: 3 })) })
const funnel = q => { const steps = (q.get('steps') || 'page_view,signup').split(','); return { from: iso(-7), to: iso(), timezone: 'UTC', subject_kind: q.get('subject_kind') || 'visitor', identity_attribution: 'all_linked', facts_deduplicated: true, source_event_count: 21960, query_hash: 'fixture', computed_at: iso(), truncated: false, steps: steps.map((name, index) => ({ name, count: 3200 - index * 700, conversion: index ? 78.13 : 100, dropoff: index ? 700 : 0 })) } }
const retention = q => ({ kind: 'retention', from: iso(-30), to: iso(), timezone: q.get('timezone') || 'Asia/Shanghai', subject_kind: q.get('subject_kind') || 'visitor', identity_attribution: 'all_linked', facts_deduplicated: true, source_event_count: 21960, query_hash: 'fixture', computed_at: iso(), truncated: false, period: q.get('period') || 'day', period_count: Number(q.get('period_count') || 7), start_event: q.get('start_event') || 'page_view', return_event: q.get('return_event') || 'page_view', cohorts: [{ cohort_start: iso(-7), cohort_size: 320, retained: Array.from({ length: Number(q.get('period_count') || 7) }, (_, index) => ({ period: index + 1, count: 210 - index * 12, rate: 65.62 - index * 3.75 })) }] })
const pathAnalysis = q => ({ kind: 'path', from: iso(-30), to: iso(), timezone: 'Asia/Shanghai', subject_kind: q.get('subject_kind') || 'visitor', identity_attribution: 'all_linked', facts_deduplicated: true, source_event_count: 21960, query_hash: 'fixture', computed_at: iso(), truncated: false, start_event: q.get('start_event') || 'page_view', depth: Number(q.get('depth') || 3), levels: [{ depth: 1, nodes: [{ parent_path: [], name: 'signup', count: 812 }, { parent_path: [], name: 'view_pricing', count: 603 }], other_count: 111 }, { depth: 2, nodes: [{ parent_path: ['signup'], name: 'checkout_complete', count: 386 }], other_count: 0 }] })
const userJourney = profile => ({ profile, from: iso(-30), to: iso(), has_more: false, items: [
  { occurred_at: iso(0, -1), kind: 'page', name: 'page_view', route: '/bids/:bidId/', release: 'web-2026.09.12' },
  { occurred_at: iso(0, -2), kind: 'action', name: 'acme.workspace.record.export.attempt', route: null, release: 'web-2026.09.12' },
  { occurred_at: iso(0, -3), kind: 'page', name: 'acme.workspace.record_list.page_enter', route: '/records/', release: 'web-2026.09.12' },
] })
const usage = () => Array.from({ length: 7 }, (_, index) => ({ usage_date: iso(index - 6).slice(0, 10), lane: ['analytics', 'error', 'behavior', 'replay', 'performance'][index % 5], received_events: 1200 + index * 39, received_bytes: 320000 + index * 10000 }))
const subscription = () => ({ subscription_id: 'subscription-fixture', cycle_started_at: iso(-12), cycle_ends_at: iso(18), hard_limit_enabled: false, grace_percent: 10, plan: { id: 'plan-fixture', code: 'internal-preview', name: '预览套餐', included_events: 100000, included_errors: 10000, included_behavior_events: 50000, included_replay_bytes: 1_073_741_824, retention_days_max: 365, export_concurrency: 2, member_limit: 20 }, counters: ['analytics', 'error', 'behavior', 'replay', 'performance'].map((lane, index) => ({ lane, accepted_events: 12000 - index * 1000, accepted_bytes: 2_000_000, adjustment_events: 0, adjustment_bytes: 0 })) })
const replayEvents = () => [{ t: 'snapshot', at: now.getTime() - 123000, tree: { tag: 'main', children: [{ tag: 'h1' }, { tag: 'button', id: 'signup-submit' }] } }, ...Array.from({ length: 122 }, (_, index) => index % 17 === 0 ? { t: 'route', at: now.getTime() - (122 - index) * 1000, route: index % 34 === 0 ? '/pricing' : '/signup' } : { t: 'scroll', at: now.getTime() - (122 - index) * 1000, x: 0, y: index * 24 })]

http.createServer((request, response) => {
  const origin = request.headers.origin
  if (origin === 'http://127.0.0.1:5174') {
    response.setHeader('access-control-allow-origin', origin)
    response.setHeader('access-control-allow-credentials', 'true')
  }
  response.setHeader('vary', 'Origin')
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  if (request.method === 'OPTIONS') { response.setHeader('access-control-allow-methods', 'GET, OPTIONS'); response.setHeader('access-control-allow-headers', 'content-type, x-csrf-token, idempotency-key'); response.writeHead(204).end(); return }
  if (request.method !== 'GET') { response.writeHead(405).end(JSON.stringify(failure('method_not_allowed', '本地预览 mock 不接受写入请求。'))); return }
  const url = new URL(request.url, `http://${host}:${port}`)
  const mode = url.searchParams.get('fixture') || process.env.CONSOLE_FIXTURE_MODE
  if (mode === 'forbidden') { response.writeHead(403).end(JSON.stringify(failure('forbidden', '这是本地合成的权限不足状态。'))); return }
  if (mode === 'error') { response.writeHead(500).end(JSON.stringify(failure('fixture_error', '这是本地合成的服务错误状态。'))); return }
  if (mode === 'logged-out' && url.pathname === '/api/auth/me') { response.writeHead(401).end(JSON.stringify(failure('authentication_required', '这是本地合成的未登录状态。'))); return }
  if (mode === 'no-project' && url.pathname === `/api/tenants/${tenant.id}/projects`) { response.writeHead(200).end(JSON.stringify(ok({ items: [] }))); return }
  const projectMatch = new RegExp(`^/api/tenants/${tenant.id}/projects/([^/]+)`).exec(url.pathname)
  if (projectMatch?.[1] === forbiddenProject.id) { response.writeHead(403).end(JSON.stringify(failure('forbidden', '这是 project-forbidden 的本地合成权限状态。'))); return }
  if (projectMatch?.[1] === errorProject.id) { response.writeHead(500).end(JSON.stringify(failure('fixture_error', '这是 project-error 的本地合成服务错误状态。'))); return }
  const data = dataFor(url.pathname, url.searchParams)
  if (!data) { response.writeHead(404).end(JSON.stringify(failure('not_found', `未定义本地 fixture：${url.pathname}`))); return }
  response.writeHead(200).end(JSON.stringify(ok(data)))
}).listen(port, host, () => console.log(`Synthetic read-only console fixture: http://${host}:${port}`))
