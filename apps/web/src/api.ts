import type { ApiFailure, ApiSuccess, CapturePolicy, DataLifecyclePolicy, ManagementProject, ManagementProjectInput, PageCapturePolicy, ProjectPolicyValue, TenantDefaultsInput, TenantDefaultsResponse } from '@zhiji/contracts'
export type { CapturePolicy, DataLifecyclePolicy, PageCapturePolicy, ProjectPolicyValue, TenantDefaultsInput, TenantDefaultsResponse } from '@zhiji/contracts'

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly requestId?: string) {
    super(message)
  }
}

export interface Tenant { id: string; name: string; role: 'owner' | 'admin' | 'member' | 'viewer' }
export interface TenantMember { user_id: string; email: string; display_name: string; role: Tenant['role']; all_projects: boolean; project_ids: string[] }
export interface Viewer { id: string; email: string; display_name: string; tenants: Tenant[] }
/** Console only toggles capture switches; complete policy data remains server-owned. */
export interface Project extends Omit<ManagementProject, 'behavior_capture' | 'session_replay' | 'performance_capture'> {
  behavior_capture: CapturePolicy
  session_replay: CapturePolicy
  performance_capture: CapturePolicy
}
export type ConsoleProjectUpdate = Omit<ManagementProjectInput, 'behavior_capture' | 'session_replay' | 'performance_capture'> & {
  behavior_capture?: CapturePolicy
  session_replay?: CapturePolicy
  performance_capture?: CapturePolicy
}
export type ProjectKeyType = 'browser' | 'server' | 'mobile' | 'otel' | 'sourcemap_upload'
export interface ProjectKey { id: string; key_type: ProjectKeyType; label: string; prefix: string; created_at: string; disabled_at: string | null }
export interface CreatedProjectKey { key: ProjectKey; secret: string }
export interface ErrorGroup { id: string; status: 'unresolved' | 'resolved' | 'ignored'; type: string; display_message: string; release: string | null; first_seen: string; last_seen: string; occurrence_count: number; resolved_at: string | null; state_version: number }
export interface ErrorOccurrence { id: string; occurred_at: string; route: string | null; url: string | null; stack: string | null; visitor_id: string; release: string | null }
export interface ErrorDetail { group: ErrorGroup; affected_visitor_count: number; recent_occurrences: ErrorOccurrence[]; history: Array<{ id: string; from_status: string; to_status: string; occurred_at: string; reason: string | null }> }
export interface TrendPoint { bucket_start: string; event_name: string; event_count: number; page_views: number; visitors: number }
export interface ProjectDashboard { from: string; to: string; granularity: 'hour' | 'day'; summary: { pv: number; visitors: number; business_users: number; event_count: number; unresolved_errors: number }; core_event_series: TrendPoint[]; error_top10: Array<{ id: string; title: string; occurrence_count: number; last_seen: string }> }
export interface EventExplorerResult { from: string; to: string; group_by: 'name' | 'route' | 'release'; items: Array<{ value: string; count: number }>; truncated: boolean }
export interface PerformanceMetric { metric_name: 'CLS' | 'INP' | 'LCP' | 'FCP' | 'TTFB'; page_key: string | null; release: string | null; sample_count: number; p50: number | null; p75: number | null; p95: number | null; good_count: number; needs_improvement_count: number; poor_count: number }
export interface PerformanceDetailMetric { release: string | null; sample_count: number; p50: number | null; p75: number | null; p95: number | null; good_count: number; needs_improvement_count: number; poor_count: number }
export interface PerformanceDetailPoint extends PerformanceDetailMetric { bucket_start: string; navigation_scope: 'hard' | 'soft' }
export interface PerformanceDetail { from: string; to: string; page_key: string; metric: PerformanceMetric['metric_name']; points: PerformanceDetailPoint[]; page_versions: PerformanceDetailMetric[] }
export interface HeatmapBin { x: number; y: number; count: number }
export interface HeatmapSummary { id: string; page_key: string; page_version: string | null; viewport_width_bucket: number; action: string; sample_count: number; coverage_from: string; coverage_to: string; has_screenshot: boolean }
export interface HeatmapDetail { id: string; page_key: string; page_version: string | null; viewport_width_bucket: number; action: string; grid_size: number; bins: HeatmapBin[]; background: { available: false } }
export interface ReplaySession { id: string; visitor_id: string; business_user_id: string | null; started_at: string; release: string | null; initial_route: string; chunk_count: number }
export interface ReplayChunk { sequence_start: number; sequence_end: number; occurred_from: string; occurred_to: string; timeline: { events: Array<Record<string, unknown>> } }
export type FunnelSubjectKind = 'visitor' | 'business_user'
export interface FunnelStep { name: string; count: number; conversion: number; dropoff: number }
export interface FunnelResult {
  from: string; to: string; timezone: 'UTC'; subject_kind: FunnelSubjectKind; identity_attribution: 'all_linked'
  facts_deduplicated: true; source_event_count: number; query_hash: string; computed_at: string; truncated: false; steps: FunnelStep[]
}
export type RetentionPeriod = 'day' | 'week' | 'month'
export interface RetentionCohort { cohort_start: string; cohort_size: number; retained: Array<{ period: number; count: number; rate: number }> }
export interface RetentionResult {
  kind: 'retention'; from: string; to: string; timezone: string; subject_kind: FunnelSubjectKind; identity_attribution: 'all_linked'
  facts_deduplicated: true; source_event_count: number; query_hash: string; computed_at: string; truncated: false
  period: RetentionPeriod; period_count: number; start_event: string; return_event: string; cohorts: RetentionCohort[]
}
export interface PathNode { parent_path: string[]; name: string; count: number }
export interface PathLevel { depth: number; nodes: PathNode[]; other_count: number }
export interface PathResult {
  kind: 'path'; from: string; to: string; timezone: string; subject_kind: FunnelSubjectKind; identity_attribution: 'all_linked'
  facts_deduplicated: true; source_event_count: number; query_hash: string; computed_at: string; truncated: false
  start_event: string; depth: number; levels: PathLevel[]
}
export type AlertNotificationType = 'lark_bot' | 'email' | 'webhook'
export type AlertRuleType = 'error_new' | 'error_regression' | 'error_count' | 'performance_p75' | 'performance_rating'
export interface CreatedAlertTarget { id: string; enabled: boolean }
export interface CreatedAlertRule { id: string }
export type AlertCondition = Record<string, number>
/** Read models intentionally exclude every transport address, credential and secret. */
export interface AlertTarget {
  id: string; type: AlertNotificationType; label: string; enabled: boolean
  verified_at: string | null; created_at: string; updated_at: string; disabled_at: string | null
}
export interface AlertRule {
  id: string; name: string; enabled: boolean; rule_type: AlertRuleType; condition: AlertCondition
  target_ids: string[]; targets_version: number; created_at: string; updated_at: string
}
/** Alert evaluation history is intentionally limited to the server-scrubbed summary. */
export interface AlertInstance {
  id: string; rule: { id: string; name: string; type: AlertRuleType }; status: string
  first_triggered_at: string; last_triggered_at: string; last_evaluated_at: string; cooldown_until: string
  summary: Record<string, number | string>
}
/** Delivery history contains no endpoint, mailbox, URL, token, or secret. */
export interface AlertDelivery {
  id: string; alert_instance_id: string
  target: { id: string; type: AlertNotificationType; label: string }
  status: string; attempt_count: number; last_attempt_at: string | null; delivered_at: string | null
  error_code: string | null; created_at: string
}
export type InvitationRole = 'admin' | 'member' | 'viewer'
export interface Invitation {
  id: string; role: InvitationRole; expires_at: string; accepted_at: string | null; revoked_at: string | null; created_at: string
}
/** A newly generated password is returned only for a newly created account. */
export interface DirectMemberCreation {
  member: { user_id: string; email: string; display_name: string; role: InvitationRole }
  existing_user: boolean
  initial_password?: string
}
export interface UsageDaily { usage_date: string; lane: 'analytics' | 'error' | 'behavior' | 'replay' | 'performance'; received_events: number; received_bytes: number }
export interface UsageReport {
  from: string; to: string; lane: UsageDaily['lane'] | null
  totals: { received_events: number; received_bytes: number }; daily: UsageDaily[]
}
export interface SubscriptionPlan {
  id: string; code: string; name: string
  included_events: number; included_errors: number; included_behavior_events: number; included_replay_bytes: number
  retention_days_max: number; export_concurrency: number; member_limit: number
}
export interface UsageCycleCounter {
  lane: UsageDaily['lane']; accepted_events: number; accepted_bytes: number; adjustment_events: number; adjustment_bytes: number
}
/** Internal allocation only. This model contains neither prices nor payment-provider state. */
export interface UsageSubscription {
  subscription_id: string; cycle_started_at: string; cycle_ends_at: string; hard_limit_enabled: boolean; grace_percent: number
  plan: SubscriptionPlan; counters: UsageCycleCounter[]
}
export type SsoRole = 'admin' | 'member' | 'viewer'
/** The API deliberately never returns an OIDC client secret. */
export interface SsoConnection {
  id: string; issuer: string; client_id: string; allowed_email_domains: string[]; default_role: SsoRole; enabled: boolean
}
/** Deliberately narrow tenant audit read model. The API never exposes write-side metadata or request correlation data. */
export interface AuditLogEntry {
  id: string
  action: string
  target_type: string
  target_id: string
  actor_user_id: string | null
  created_at: string
}
export type InsightKind = 'trend' | 'funnel' | 'retention' | 'path'
export type InsightVisibility = 'private' | 'project'
/** These are the only supported saved-query fields. The console never accepts an arbitrary query document. */
export interface SavedInsightDefinition {
  schema_version: 1; kind: InsightKind; subject_kind: FunnelSubjectKind; from: string; to: string; timezone: string
  event_names?: string[]; granularity?: 'hour' | 'day'; steps?: string[]; start_event?: string; return_event?: string
  period?: RetentionPeriod; period_count?: number; depth?: number
}
export interface SavedInsight {
  id: string; name: string; description: string | null; kind: InsightKind; definition: SavedInsightDefinition
  definition_version: number; visibility: InsightVisibility; created_by: string; updated_by: string; created_at: string; updated_at: string
}
export interface DashboardTile {
  id: string; saved_insight_id: string; position: number; width: number; height: number; title_override: string | null; tile_version: number
  insight?: { name: string; kind: InsightKind; definition: SavedInsightDefinition }
}
export interface SavedDashboard {
  id: string; name: string; description: string | null; visibility: 'project'; version: number; created_by: string; updated_by: string; created_at: string; updated_at: string
}
export interface DashboardDetail extends SavedDashboard { tiles: DashboardTile[] }
export type ReportCadence = 'daily' | 'weekly' | 'monthly'
export interface ReportSchedule {
  id: string; target_type: 'insight' | 'dashboard'; target_id: string; cadence: ReportCadence; timezone: string; next_run_at: string; enabled: boolean
  /** Identifier only; notification address and secret are intentionally absent. */
  notification_target_id: string; created_by: string; updated_by: string; created_at: string; updated_at: string
  latest_run: null | { id: string; status: string; scheduled_for: string | null; finished_at: string | null; error_code: string | null }
}
export interface CohortDefinition { schema_version: 1; event_name: string; min_occurrences: number; max_occurrences?: number; window: { kind: 'relative'; days: number } | { kind: 'absolute'; from: string; to: string }; property_filters?: Array<{ key: string; value: string | number | boolean }> }
export interface Cohort { id: string; name: string; description: string | null; subject_kind: FunnelSubjectKind; definition: CohortDefinition; definition_version: number; visibility: InsightVisibility; created_by: string; updated_by: string; created_at: string; updated_at: string }
export interface CohortPreview { cohort_id: string; definition_version: number; identity_attribution: 'all_linked'; facts_deduplicated: boolean; snapshot: { calculated_at: string; range_from: string; range_to: string; subject_kind: FunnelSubjectKind; member_count: number; expires_at: string; members_available: false } }
export interface AnalyticsExport { id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired'; format: 'csv' | 'xlsx'; row_count: number | null; byte_count: number | null; error_code: string | null; created_at: string; started_at: string | null; finished_at: string | null; expires_at: string }
/** Artifact locations and download tokens deliberately never enter this model. */
export interface SubjectLifecycleJob {
  id: string; kind: 'subject_export' | 'subject_deletion'; status: 'queued' | 'running' | 'completed' | 'failed' | 'expired' | 'cancelled'
  subject_business_user_id: string; verification_method: string; reauthenticated_at: string; created_at: string
  started_at: string | null; finished_at: string | null; expires_at: string; reason_code: string | null; byte_count: number | null
}
export interface ProjectDeletionRequest { id: string; status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; effective_at: string; created_at: string; cancelled_at: string | null; project_status?: 'active' | 'pending' | 'deleting' | 'deleted' }
/** Safe Source Map inventory metadata. Maps, source paths and upload keys are never returned to the console. */
export interface SourceMapArtifact {
  id: string; release: string; dist: string; artifact_path: string; map_sha256: string; source_count: number
  created_at: string; superseded_at: string | null
}

export class ApiClient {
  constructor(private readonly baseUrl = '') {}

  async get<T>(path: string, signal?: AbortSignal): Promise<T> { return this.request<T>(path, { signal }) }
  async patch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', signal, headers: writeHeaders(), body: JSON.stringify(body) })
  }
  async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { method: 'POST', signal, headers: writeHeaders(), body: JSON.stringify(body) })
  }
  async put<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { method: 'PUT', signal, headers: writeHeaders(), body: JSON.stringify(body) })
  }
  async delete<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', signal, headers: writeHeaders(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response
    try { response = await fetch(`${this.baseUrl}${path}`, { credentials: 'include', ...init }) }
    catch (error) {
      if (init.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw new DOMException('Request cancelled', 'AbortError')
      throw new ApiError(0, 'network_error', '无法连接知迹服务。请检查网络或稍后重试。')
    }
    const payload = await response.json().catch(() => null) as ApiSuccess<T> | ApiFailure | null
    if (!response.ok || !payload || !('data' in payload)) {
      const failure = payload && 'error' in payload ? payload : undefined
      throw new ApiError(response.status, failure?.error.code ?? 'request_failed', failure?.error.message ?? '请求失败，请稍后重试。', failure?.meta.request_id)
    }
    return payload.data
  }

  me(signal?: AbortSignal) { return this.get<{ user_id: string; tenants: Tenant[] }>('/api/auth/me', signal) }
  login(email: string, password: string, signal?: AbortSignal) { return this.post<{ expires_at: string }>('/api/auth/login', { email, password }, signal) }
  logout(signal?: AbortSignal) { return this.post<{ revoked: boolean }>('/api/auth/logout', {}, signal) }
  projects(tenantId: string, signal?: AbortSignal) { return this.get<{ items: Project[] }>(`/api/tenants/${encodeURIComponent(tenantId)}/projects`, signal) }
  createProject(tenantId: string, body: Pick<ManagementProjectInput, 'name'>, signal?: AbortSignal) { return this.post<{ project: Project }>(`/api/tenants/${encodeURIComponent(tenantId)}/projects`, body, signal) }
  updateProject(tenantId: string, projectId: string, body: ConsoleProjectUpdate, signal?: AbortSignal) { return this.patch<{ project: Project }>(scoped(tenantId, projectId, ''), body, signal) }
  keys(tenantId: string, projectId: string, signal?: AbortSignal) { return this.get<{ items: ProjectKey[] }>(scoped(tenantId, projectId, '/keys'), signal) }
  createKey(tenantId: string, projectId: string, body: { label: string; key_type: ProjectKeyType }, signal?: AbortSignal) { return this.post<CreatedProjectKey>(scoped(tenantId, projectId, '/keys'), body, signal) }
  rotateKey(tenantId: string, projectId: string, keyId: string, body: { label?: string }, signal?: AbortSignal) { return this.post<CreatedProjectKey>(scoped(tenantId, projectId, `/keys/${encodeURIComponent(keyId)}/rotate`), body, signal) }
  disableKey(tenantId: string, projectId: string, keyId: string, signal?: AbortSignal) { return this.request<{ key: ProjectKey }>(scoped(tenantId, projectId, `/keys/${encodeURIComponent(keyId)}`), { method: 'DELETE', signal, headers: writeHeaders() }) }
  errors(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) { return this.get<{ items: ErrorGroup[]; next_cursor: string | null }>(scoped(tenantId, projectId, `/errors?${query}`), signal) }
  error(tenantId: string, projectId: string, groupId: string, signal?: AbortSignal) { return this.get<ErrorDetail>(scoped(tenantId, projectId, `/errors/${encodeURIComponent(groupId)}`), signal) }
  setErrorStatus(tenantId: string, projectId: string, group: ErrorGroup, status: ErrorGroup['status'], signal?: AbortSignal) { return this.patch<{ group_id: string; status: ErrorGroup['status']; state_version: number }>(scoped(tenantId, projectId, `/errors/${encodeURIComponent(group.id)}/status`), { status, expected_state_version: group.state_version }, signal) }
  trend(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) { return this.get<{ from: string; to: string; granularity: string; points: TrendPoint[] }>(scoped(tenantId, projectId, `/analytics/trend?${query}`), signal) }
  projectDashboard(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) { return this.get<ProjectDashboard>(scoped(tenantId, projectId, `/dashboard?${query}`), signal) }
  eventExplorer(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) { return this.get<EventExplorerResult>(scoped(tenantId, projectId, `/events?${query}`), signal) }
  performance(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) { return this.get<{ from: string; to: string; items: PerformanceMetric[] }>(scoped(tenantId, projectId, `/performance?${query}`), signal) }
  performanceDetail(tenantId: string, projectId: string, pageKey: string, query: URLSearchParams, signal?: AbortSignal) { return this.get<PerformanceDetail>(scoped(tenantId, projectId, `/performance/pages/${encodeURIComponent(pageKey)}?${query}`), signal) }
  heatmaps(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) { return this.get<{ page_key: string; items: HeatmapSummary[] }>(scoped(tenantId, projectId, `/heatmaps?${query}`), signal) }
  heatmapDetail(tenantId: string, projectId: string, heatmapId: string, query: URLSearchParams, signal?: AbortSignal) { return this.get<HeatmapDetail>(scoped(tenantId, projectId, `/heatmaps/${encodeURIComponent(heatmapId)}?${query}`), signal) }
  usage(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) { return this.get<UsageReport>(scoped(tenantId, projectId, `/usage?${query}`), signal) }
  usageSubscription(tenantId: string, signal?: AbortSignal) { return this.get<{ subscription: UsageSubscription | null }>(`/api/tenants/${encodeURIComponent(tenantId)}/usage`, signal) }
  tenantDefaults(tenantId: string, signal?: AbortSignal) { return this.get<{ tenant: TenantDefaultsResponse }>(`/api/tenants/${encodeURIComponent(tenantId)}/settings`, signal) }
  updateTenantDefaults(tenantId: string, body: TenantDefaultsInput, signal?: AbortSignal) { return this.patch<{ tenant: TenantDefaultsResponse }>(`/api/tenants/${encodeURIComponent(tenantId)}/settings`, body, signal) }
  updateUsageSubscription(tenantId: string, body: { hard_limit_enabled?: boolean; grace_percent?: number }, signal?: AbortSignal) { return this.patch<{ subscription: UsageSubscription }>(`/api/tenants/${encodeURIComponent(tenantId)}/subscription`, body, signal) }
  adjustUsage(tenantId: string, body: { lane: UsageDaily['lane']; delta_events: number; delta_bytes: number; reason: string }, signal?: AbortSignal) { return this.post<{ subscription: UsageSubscription }>(`/api/tenants/${encodeURIComponent(tenantId)}/usage-adjustments`, body, signal) }
  funnel(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) { return this.get<FunnelResult>(scoped(tenantId, projectId, `/funnel?${query}`), signal) }
  retention(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) { return this.get<RetentionResult>(scoped(tenantId, projectId, `/analytics/retention?${query}`), signal) }
  pathAnalysis(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) { return this.get<PathResult>(scoped(tenantId, projectId, `/analytics/path?${query}`), signal) }
  insights(tenantId: string, projectId: string, signal?: AbortSignal) { return this.get<{ items: SavedInsight[] }>(scoped(tenantId, projectId, '/insights'), signal) }
  createInsight(tenantId: string, projectId: string, body: { name: string; description: string | null; visibility: InsightVisibility; definition: SavedInsightDefinition }, signal?: AbortSignal) { return this.post<SavedInsight>(scoped(tenantId, projectId, '/insights'), body, signal) }
  updateInsight(tenantId: string, projectId: string, insightId: string, body: { name: string; description: string | null; visibility: InsightVisibility; definition: SavedInsightDefinition; expected_definition_version: number }, signal?: AbortSignal) { return this.patch<SavedInsight>(scoped(tenantId, projectId, `/insights/${encodeURIComponent(insightId)}`), body, signal) }
  archiveInsight(tenantId: string, projectId: string, insightId: string, expectedDefinitionVersion: number, signal?: AbortSignal) { return this.delete<{ archived: true }>(scoped(tenantId, projectId, `/insights/${encodeURIComponent(insightId)}`), { expected_definition_version: expectedDefinitionVersion }, signal) }
  dashboards(tenantId: string, projectId: string, signal?: AbortSignal) { return this.get<{ items: SavedDashboard[] }>(scoped(tenantId, projectId, '/dashboards'), signal) }
  dashboard(tenantId: string, projectId: string, dashboardId: string, signal?: AbortSignal) { return this.get<DashboardDetail>(scoped(tenantId, projectId, `/dashboards/${encodeURIComponent(dashboardId)}`), signal) }
  createDashboard(tenantId: string, projectId: string, body: { name: string; description: string | null }, signal?: AbortSignal) { return this.post<SavedDashboard>(scoped(tenantId, projectId, '/dashboards'), body, signal) }
  updateDashboard(tenantId: string, projectId: string, dashboardId: string, body: { name: string; description: string | null; expected_version: number }, signal?: AbortSignal) { return this.patch<SavedDashboard>(scoped(tenantId, projectId, `/dashboards/${encodeURIComponent(dashboardId)}`), body, signal) }
  archiveDashboard(tenantId: string, projectId: string, dashboardId: string, expectedVersion: number, signal?: AbortSignal) { return this.delete<{ archived: true }>(scoped(tenantId, projectId, `/dashboards/${encodeURIComponent(dashboardId)}`), { expected_version: expectedVersion }, signal) }
  replaceDashboardTiles(tenantId: string, projectId: string, dashboardId: string, body: { expected_version: number; tiles: Array<{ id?: string; saved_insight_id: string; position: number; width: number; height: number; title_override: string | null; tile_version?: number }> }, signal?: AbortSignal) { return this.put<DashboardDetail>(scoped(tenantId, projectId, `/dashboards/${encodeURIComponent(dashboardId)}/tiles`), body, signal) }
  reportSchedules(tenantId: string, projectId: string, query = new URLSearchParams({ limit: '100' }), signal?: AbortSignal) { return this.get<{ items: ReportSchedule[]; next_cursor: string | null }>(scoped(tenantId, projectId, `/report-schedules?${query.toString()}`), signal) }
  createReportSchedule(tenantId: string, projectId: string, body: { target_type: 'insight' | 'dashboard'; target_id: string; cadence: ReportCadence; timezone: string; next_run_at: string; enabled: boolean; notification_target_id: string }, signal?: AbortSignal) { return this.post<ReportSchedule>(scoped(tenantId, projectId, '/report-schedules'), body, signal) }
  updateReportSchedule(tenantId: string, projectId: string, scheduleId: string, body: { expected_updated_at: string; enabled?: boolean; cadence?: ReportCadence; timezone?: string; next_run_at?: string; notification_target_id?: string }, signal?: AbortSignal) { return this.patch<ReportSchedule>(scoped(tenantId, projectId, `/report-schedules/${encodeURIComponent(scheduleId)}`), body, signal) }
  disableReportSchedule(tenantId: string, projectId: string, scheduleId: string, expectedUpdatedAt: string, signal?: AbortSignal) { return this.delete<ReportSchedule>(scoped(tenantId, projectId, `/report-schedules/${encodeURIComponent(scheduleId)}`), { expected_updated_at: expectedUpdatedAt }, signal) }
  cohorts(tenantId: string, projectId: string, signal?: AbortSignal) { return this.get<{ items: Cohort[] }>(scoped(tenantId, projectId, '/cohorts'), signal) }
  createCohort(tenantId: string, projectId: string, body: { name: string; description: string | null; visibility: InsightVisibility; subject_kind: FunnelSubjectKind; definition: CohortDefinition }, signal?: AbortSignal) { return this.post<Cohort>(scoped(tenantId, projectId, '/cohorts'), body, signal) }
  updateCohort(tenantId: string, projectId: string, cohortId: string, body: { name: string; description: string | null; visibility: InsightVisibility; subject_kind: FunnelSubjectKind; definition: CohortDefinition; expected_definition_version: number }, signal?: AbortSignal) { return this.patch<Cohort>(scoped(tenantId, projectId, `/cohorts/${encodeURIComponent(cohortId)}`), body, signal) }
  archiveCohort(tenantId: string, projectId: string, cohortId: string, expectedDefinitionVersion: number, signal?: AbortSignal) { return this.delete<{ archived: true }>(scoped(tenantId, projectId, `/cohorts/${encodeURIComponent(cohortId)}`), { expected_definition_version: expectedDefinitionVersion }, signal) }
  previewCohort(tenantId: string, projectId: string, cohortId: string, signal?: AbortSignal) { return this.post<CohortPreview>(scoped(tenantId, projectId, `/cohorts/${encodeURIComponent(cohortId)}/preview`), {}, signal) }
  createAnalyticsExport(tenantId: string, projectId: string, body: { format: 'csv' | 'xlsx'; target: { type: 'insight' | 'dashboard'; id: string } }, signal?: AbortSignal) { return this.request<{ job_id: string; status: 'queued' }>(scoped(tenantId, projectId, '/analytics-exports'), { method: 'POST', signal, headers: { ...writeHeaders(), 'Idempotency-Key': idempotencyKey() }, body: JSON.stringify(body) }) }
  analyticsExport(tenantId: string, projectId: string, exportJobId: string, signal?: AbortSignal) { return this.get<AnalyticsExport>(scoped(tenantId, projectId, `/analytics-exports/${encodeURIComponent(exportJobId)}`), signal) }
  cancelAnalyticsExport(tenantId: string, projectId: string, exportJobId: string, signal?: AbortSignal) { return this.post<{ status: 'cancelled' }>(scoped(tenantId, projectId, `/analytics-exports/${encodeURIComponent(exportJobId)}/cancel`), {}, signal) }
  async downloadAnalyticsExport(tenantId: string, projectId: string, exportJobId: string, signal?: AbortSignal): Promise<{ blob: Blob; format: 'csv' | 'xlsx' }> {
    const token = await this.get<{ token: string; expires_in_seconds: number }>(scoped(tenantId, projectId, `/analytics-exports/${encodeURIComponent(exportJobId)}/download`), signal)
    const path = scoped(tenantId, projectId, `/analytics-exports/${encodeURIComponent(exportJobId)}/download?token=${encodeURIComponent(token.token)}`)
    let response: Response
    try { response = await fetch(`${this.baseUrl}${path}`, { credentials: 'include', cache: 'no-store', signal }) } catch { throw new ApiError(0, 'network_error', '无法下载导出文件。请检查网络或稍后重试。') }
    if (!response.ok) { const payload = await response.json().catch(() => null) as ApiFailure | null; throw new ApiError(response.status, payload?.error.code ?? 'download_failed', payload?.error.message ?? '导出文件不可用，请重新生成。', payload?.meta.request_id) }
    const type = response.headers.get('content-type') ?? ''
    return { blob: await response.blob(), format: type.includes('spreadsheetml') ? 'xlsx' : 'csv' }
  }
  subjectExports(tenantId: string, projectId: string, signal?: AbortSignal) { return this.get<{ items: SubjectLifecycleJob[] }>(scoped(tenantId, projectId, '/data-exports'), signal) }
  subjectDeletions(tenantId: string, projectId: string, signal?: AbortSignal) { return this.get<{ items: SubjectLifecycleJob[] }>(scoped(tenantId, projectId, '/deletions'), signal) }
  issueLifecycleProof(tenantId: string, projectId: string, body: { operation: 'subject_export' | 'subject_deletion' | 'project_deletion'; subject_business_user_id?: string; purpose: string; password: string }, signal?: AbortSignal) { return this.post<{ proof: string; expires_at: string }>(scoped(tenantId, projectId, '/lifecycle-proofs'), body, signal) }
  requestSubjectExport(tenantId: string, projectId: string, body: { subject_business_user_id: string; purpose: string; proof: string }, signal?: AbortSignal) { return this.request<{ job: SubjectLifecycleJob; idempotent: boolean }>(scoped(tenantId, projectId, '/data-exports'), { method: 'POST', signal, headers: { ...writeHeaders(), 'Idempotency-Key': idempotencyKey() }, body: JSON.stringify(body) }) }
  requestSubjectDeletion(tenantId: string, projectId: string, body: { subject_business_user_id: string; purpose: string; proof: string }, signal?: AbortSignal) { return this.request<{ job: SubjectLifecycleJob; idempotent: boolean }>(scoped(tenantId, projectId, '/deletions'), { method: 'POST', signal, headers: { ...writeHeaders(), 'Idempotency-Key': idempotencyKey() }, body: JSON.stringify(body) }) }
  projectDeletion(tenantId: string, projectId: string, signal?: AbortSignal) { return this.get<{ deletion: ProjectDeletionRequest }>(scoped(tenantId, projectId, '/deletion'), signal) }
  requestProjectDeletion(tenantId: string, projectId: string, body: { confirmation: 'DELETE_PROJECT'; purpose: string; proof: string }, signal?: AbortSignal) { return this.request<{ deletion: ProjectDeletionRequest; idempotent: boolean }>(scoped(tenantId, projectId, '/deletion'), { method: 'POST', signal, headers: { ...writeHeaders(), 'Idempotency-Key': idempotencyKey() }, body: JSON.stringify(body) }) }
  cancelProjectDeletion(tenantId: string, projectId: string, signal?: AbortSignal) { return this.delete<{ deletion: ProjectDeletionRequest }>(scoped(tenantId, projectId, '/deletion'), undefined, signal) }
  async downloadSubjectExport(tenantId: string, projectId: string, jobId: string, signal?: AbortSignal): Promise<Blob> {
    const token = await this.get<{ token: string; expires_in_seconds: number }>(scoped(tenantId, projectId, `/data-exports/${encodeURIComponent(jobId)}/download`), signal)
    const path = scoped(tenantId, projectId, `/data-exports/${encodeURIComponent(jobId)}/download?token=${encodeURIComponent(token.token)}`)
    let response: Response
    try { response = await fetch(`${this.baseUrl}${path}`, { credentials: 'include', cache: 'no-store', signal }) } catch { throw new ApiError(0, 'network_error', '无法下载主体导出文件。请检查网络或稍后重试。') }
    if (!response.ok) { const payload = await response.json().catch(() => null) as ApiFailure | null; throw new ApiError(response.status, payload?.error.code ?? 'download_failed', payload?.error.message ?? '导出文件不可用，请重新生成。', payload?.meta.request_id) }
    return response.blob()
  }
  replays(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) { return this.get<{ items: ReplaySession[]; next_cursor: string | null }>(scoped(tenantId, projectId, `/replays?${query.toString()}`), signal) }
  replayChunks(tenantId: string, projectId: string, sessionId: string, signal?: AbortSignal) { return this.get<{ items: ReplayChunk[] }>(scoped(tenantId, projectId, `/replays/${encodeURIComponent(sessionId)}/chunks`), signal) }
  sourceMaps(tenantId: string, projectId: string, signal?: AbortSignal) { return this.get<{ items: SourceMapArtifact[] }>(scoped(tenantId, projectId, '/sourcemaps'), signal) }
  createAlertTarget(tenantId: string, projectId: string, body: { type: AlertNotificationType; label: string }, signal?: AbortSignal) {
    return this.post<CreatedAlertTarget>(scoped(tenantId, projectId, '/alerts/targets'), body, signal)
  }
  alertTargets(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) {
    return this.get<{ items: AlertTarget[]; next_cursor: string | null }>(scoped(tenantId, projectId, `/alerts/targets?${query.toString()}`), signal)
  }
  updateAlertTarget(tenantId: string, projectId: string, targetId: string, body: { expected_updated_at: string; label?: string; enabled?: boolean }, signal?: AbortSignal) {
    return this.patch<AlertTarget>(scoped(tenantId, projectId, `/alerts/targets/${encodeURIComponent(targetId)}`), body, signal)
  }
  disableAlertTarget(tenantId: string, projectId: string, targetId: string, expectedUpdatedAt: string, signal?: AbortSignal) {
    return this.delete<{ id: string; disabled: true }>(scoped(tenantId, projectId, `/alerts/targets/${encodeURIComponent(targetId)}`), { expected_updated_at: expectedUpdatedAt }, signal)
  }
  createAlertRule(tenantId: string, projectId: string, body: { name: string; rule_type: AlertRuleType; condition: AlertCondition; target_ids: string[] }, signal?: AbortSignal) {
    return this.post<CreatedAlertRule>(scoped(tenantId, projectId, '/alerts/rules'), body, signal)
  }
  alertRules(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) {
    return this.get<{ items: AlertRule[]; next_cursor: string | null }>(scoped(tenantId, projectId, `/alerts/rules?${query.toString()}`), signal)
  }
  updateAlertRule(tenantId: string, projectId: string, ruleId: string, body: { expected_updated_at: string; name?: string; condition?: AlertCondition; target_ids?: string[]; enabled?: boolean }, signal?: AbortSignal) {
    return this.patch<AlertRule>(scoped(tenantId, projectId, `/alerts/rules/${encodeURIComponent(ruleId)}`), body, signal)
  }
  disableAlertRule(tenantId: string, projectId: string, ruleId: string, expectedUpdatedAt: string, signal?: AbortSignal) {
    return this.delete<{ id: string; disabled: true }>(scoped(tenantId, projectId, `/alerts/rules/${encodeURIComponent(ruleId)}`), { expected_updated_at: expectedUpdatedAt }, signal)
  }
  alertInstances(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) {
    return this.get<{ items: AlertInstance[]; next_cursor: string | null }>(scoped(tenantId, projectId, `/alerts/instances?${query.toString()}`), signal)
  }
  alertDeliveries(tenantId: string, projectId: string, query: URLSearchParams, signal?: AbortSignal) {
    return this.get<{ items: AlertDelivery[]; next_cursor: string | null }>(scoped(tenantId, projectId, `/alerts/deliveries?${query.toString()}`), signal)
  }
  createInvitation(tenantId: string, body: { email: string; role: InvitationRole }, signal?: AbortSignal) {
    return this.request<{ invitation: Invitation; idempotent: boolean }>(`/api/tenants/${encodeURIComponent(tenantId)}/invitations`, { method: 'POST', signal, headers: { ...writeHeaders(), 'Idempotency-Key': idempotencyKey() }, body: JSON.stringify(body) })
  }
  createDirectMember(tenantId: string, body: { email: string; display_name: string; role: InvitationRole }, signal?: AbortSignal) {
    return this.request<DirectMemberCreation>(`/api/tenants/${encodeURIComponent(tenantId)}/members/direct`, { method: 'POST', signal, headers: writeHeaders(), body: JSON.stringify(body) })
  }
  members(tenantId: string, signal?: AbortSignal) {
    return this.get<{ items: TenantMember[] }>(`/api/tenants/${encodeURIComponent(tenantId)}/members`, signal)
  }
  updateMemberProjects(tenantId: string, userId: string, projectIds: string[], signal?: AbortSignal) {
    return this.put<{ user_id: string; project_ids: string[] }>(`/api/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}/projects`, { project_ids: projectIds }, signal)
  }
  ssoConnections(tenantId: string, signal?: AbortSignal) { return this.get<{ connections: SsoConnection[] }>(`/api/tenants/${encodeURIComponent(tenantId)}/sso/connections`, signal) }
  createSsoConnection(tenantId: string, body: { issuer: string; client_id: string; client_secret: string; allowed_email_domains: string[]; default_role: SsoRole; enabled: boolean }, signal?: AbortSignal) {
    return this.post<{ connection: SsoConnection }>(`/api/tenants/${encodeURIComponent(tenantId)}/sso/connections`, body, signal)
  }
  updateSsoConnection(tenantId: string, connectionId: string, body: Partial<{ client_id: string; client_secret: string; allowed_email_domains: string[]; default_role: SsoRole; enabled: boolean }>, signal?: AbortSignal) {
    return this.patch<{ connection: SsoConnection }>(`/api/tenants/${encodeURIComponent(tenantId)}/sso/connections/${encodeURIComponent(connectionId)}`, body, signal)
  }
  linkSsoIdentity(tenantId: string, connectionId: string, body: { subject: string; email: string; user_id: string }, signal?: AbortSignal) {
    return this.post<{ linked: true }>(`/api/tenants/${encodeURIComponent(tenantId)}/sso/connections/${encodeURIComponent(connectionId)}/identities`, body, signal)
  }
  auditLogs(tenantId: string, query: URLSearchParams, signal?: AbortSignal) {
    return this.get<{ items: AuditLogEntry[]; next_cursor: string | null }>(`/api/tenants/${encodeURIComponent(tenantId)}/audit-logs?${query.toString()}`, signal)
  }
}

function writeHeaders(): Record<string, string> {
  const token = typeof document === 'undefined' ? '' : document.cookie.split('; ').find(value => value.startsWith('zj_csrf='))?.slice('zj_csrf='.length) ?? ''
  return { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': decodeURIComponent(token) } : {}) }
}

export function scoped(tenantId: string, projectId: string, suffix: string): string {
  return `/api/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(projectId)}${suffix}`
}

export function rangeQuery(days = 7, granularity: 'hour' | 'day' = 'day'): URLSearchParams {
  const to = new Date(); const from = new Date(to.getTime() - days * 86400000)
  return new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), granularity })
}

/** Usage is aggregated by UTC calendar day, so query boundaries must be midnight UTC. */
export function usageRangeQuery(days = 30, lane?: UsageDaily['lane']): URLSearchParams {
  const now = new Date(); const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)); const from = new Date(to.getTime() - days * 86_400_000)
  return new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), ...(lane ? { lane } : {}) })
}

function idempotencyKey() { return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}` }
