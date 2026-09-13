import { Brand } from './brand'
import './console.css'
import { ConnectionGuide } from './console-onboarding'
import { TrendChart, FunnelChart } from './console-charts'
import { consoleGroups, consolePageInfo } from './console-navigation'
import { consolePath } from './console-path'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@zhiji/design/tabs'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@zhiji/design/alert-dialog'
import React, { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { ApiClient, ApiError, AlertCondition, AlertDelivery, AlertInstance, AlertNotificationType, AlertRule, AlertRuleType, AlertTarget, AnalyticsExport, AuditLogEntry, CapturePolicy, Cohort, CohortDefinition, CohortPreview, DashboardDetail, DataLifecyclePolicy, DirectMemberCreation, EventExplorerResult, InsightKind, InsightVisibility, ProjectDashboard, ReportCadence, ReportSchedule, SavedDashboard, SavedInsight, SavedInsightDefinition, ErrorDetail, ErrorGroup, FunnelResult, FunnelSubjectKind, PathResult, RetentionPeriod, RetentionResult, HeatmapBin, HeatmapSummary, HeatmapDetail, Invitation, InvitationRole, PerformanceDetail, PerformanceMetric, Project, ProjectKey, ProjectKeyType, ReplayChunk, ReplaySession, SourceMapArtifact, SubjectLifecycleJob, ProjectDeletionRequest, SsoConnection, SsoRole, Tenant, TenantDefaultsResponse, TenantMember, TrendPoint, UsageDaily, UsageReport, UsageSubscription, rangeQuery, usageRangeQuery } from './api'
import { ConsoleAlert, ConsoleAlertDescription, ConsoleAlertTitle, ConsoleBadge, ConsoleButton, ConsoleCard, ConsoleEmpty, ConsoleInput, ConsoleSelect, ConsolePageHeader, ConsoleSpinner, ConsoleStatCard, ConsoleTable, ConsoleTableBody, ConsoleTableCell, ConsoleTableHead, ConsoleTableHeader, ConsoleTableRow, ConsoleTextarea } from './ui'
import { replayFrameState, replayPlayerDocument, replayTree, ReplayTreeNode } from './replay-player'
import { UserJourneysPage } from './console-user-journeys'

const api = new ApiClient(import.meta.env.VITE_ZHIJI_API_BASE_URL ?? '')
type Route = { kind: 'dashboard' | 'errors' | 'analytics' | 'funnels' | 'retention' | 'paths' | 'journeys' | 'performance' | 'heatmaps' | 'replays' | 'alerts' | 'usage' | 'billing' | 'members' | 'auditLogs' | 'insights' | 'dashboards' | 'reportSchedules' | 'cohorts' | 'exports' | 'sourcemaps' | 'lifecycle' | 'tenantSettings' | 'settings' | 'sdk' | 'notFound'; groupId?: string; pageKey?: string; metric?: PerformanceMetric['metric_name'] }
type AppContext = { tenant: Tenant; project: Project }
type SavedConsoleContext = { tenantId?: string; projectIds: Record<string, string> }

function currentRoute(): Route {
  const parts = location.pathname.replace(/^\/console(?=\/|$)/, '').split('/').filter(Boolean)
  if (parts[0] === 'errors' && parts[1]) return { kind: 'errors', groupId: parts[1] }
  if (parts[0] === 'errors') return { kind: 'errors' }
  if (parts[0] === 'analytics') return { kind: 'analytics' }
  if (parts[0] === 'funnels') return { kind: 'funnels' }
  if (parts[0] === 'retention') return { kind: 'retention' }
  if (parts[0] === 'paths') return { kind: 'paths' }
  if (parts[0] === 'journeys') return { kind: 'journeys' }
  if (parts[0] === 'performance' && parts[1]) { const metric = new URLSearchParams(location.search).get('metric'); const pageKey = safePathPart(parts[1]); return pageKey && isPerformanceMetric(metric) ? { kind: 'performance', pageKey, metric } : { kind: 'performance' } }
  if (parts[0] === 'performance') return { kind: 'performance' }
  if (parts[0] === 'heatmaps') return { kind: 'heatmaps' }
  if (parts[0] === 'replays' && parts[1]) return { kind: 'replays', groupId: parts[1] }
  if (parts[0] === 'replays') return { kind: 'replays' }
  if (parts[0] === 'alerts') return { kind: 'alerts' }
  if (parts[0] === 'usage') return { kind: 'usage' }
  if (parts[0] === 'billing') return { kind: 'billing' }
  if (parts[0] === 'members') return { kind: 'members' }
  if (parts[0] === 'audit-logs') return { kind: 'auditLogs' }
  if (parts[0] === 'insights') return { kind: 'insights' }
  if (parts[0] === 'dashboards') return { kind: 'dashboards' }
  if (parts[0] === 'report-schedules') return { kind: 'reportSchedules' }
  if (parts[0] === 'cohorts') return { kind: 'cohorts' }
  if (parts[0] === 'exports') return { kind: 'exports' }
  if (parts[0] === 'sourcemaps') return { kind: 'sourcemaps' }
  if (parts[0] === 'lifecycle') return { kind: 'lifecycle' }
  if (parts[0] === 'tenant-settings') return { kind: 'tenantSettings' }
  if (parts[0] === 'settings') return { kind: 'settings' }
  if (parts[0] === 'sdk') return { kind: 'sdk' }
  return { kind: parts.length ? 'notFound' : 'dashboard' }
}
function isPerformanceMetric(value: string | null): value is PerformanceMetric['metric_name'] { return value === 'CLS' || value === 'INP' || value === 'LCP' || value === 'FCP' || value === 'TTFB' }
function safePathPart(value: string): string | undefined { try { const decoded = decodeURIComponent(value); return decoded.length > 0 && decoded.length <= 500 ? decoded : undefined } catch { return undefined } }
function navigate(path: string) {
  const scoped = consolePath(path)
  history.pushState({}, '', scoped)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
function queryValue(key: string, fallback = '') { return new URLSearchParams(location.search).get(key) ?? fallback }
function replaceConsoleQuery(updates: Record<string, string | undefined>) {
  const query = new URLSearchParams(location.search)
  Object.entries(updates).forEach(([key, value]) => value ? query.set(key, value) : query.delete(key))
  history.replaceState({}, '', `${location.pathname}${query.size ? `?${query}` : ''}`)
}
function pushConsoleQuery(updates: Record<string, string | undefined>) {
  const query = new URLSearchParams(location.search)
  Object.entries(updates).forEach(([key, value]) => value ? query.set(key, value) : query.delete(key))
  history.pushState({}, '', `${location.pathname}${query.size ? `?${query}` : ''}`)
  dispatchEvent(new PopStateEvent('popstate'))
}
function daysQuery(key: string, fallback: 7 | 30 | 90): 7 | 30 | 90 { const value = Number(queryValue(key)); return value === 7 || value === 30 || value === 90 ? value : fallback }
function subjectQuery(): FunnelSubjectKind { return queryValue('subject') === 'business_user' ? 'business_user' : 'visitor' }
function groupQuery(): 'name' | 'route' | 'release' { const value = queryValue('group_by'); return value === 'route' || value === 'release' ? value : 'name' }
function periodQuery(): RetentionPeriod { const value = queryValue('period'); return value === 'week' || value === 'month' ? value : 'day' }
function periodCountQuery(): 1 | 3 | 7 | 12 { const value = Number(queryValue('period_count')); return value === 1 || value === 3 || value === 12 ? value : 7 }
function depthQuery(): 2 | 3 | 4 | 5 { const value = Number(queryValue('depth')); return value === 2 || value === 4 || value === 5 ? value : 3 }
function listQuery(key: string, fallback: string[], minimum: number, maximum: number): string[] { const values = queryValue(key).split(',').map(value => value.trim()).filter(Boolean); return values.length >= minimum && values.length <= maximum ? values : fallback }
function errorStatusQuery(): 'all' | ErrorGroup['status'] { const value = queryValue('status'); return value === 'unresolved' || value === 'resolved' || value === 'ignored' ? value : 'all' }
function ConfirmAction({ label, title, impact, confirmLabel = '确认继续', disabled, onConfirm }: { label: string; title: string; impact: string; confirmLabel?: string; disabled?: boolean; onConfirm: () => void }) {
  return <AlertDialog><AlertDialogTrigger asChild><ConsoleButton type="button" className="danger" disabled={disabled}>{label}</ConsoleButton></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{impact}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={onConfirm}>{confirmLabel}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}

export function ConsoleApp() {
  const [viewer, setViewer] = useState<{ user_id: string; tenants: Tenant[] } | null>(null)
  const [context, setContext] = useState<AppContext | null>(null)
  const [route, setRoute] = useState(currentRoute)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => { const onPop = () => setRoute(currentRoute()); addEventListener('popstate', onPop); return () => removeEventListener('popstate', onPop) }, [])
  useEffect(() => { let cancelled = false; const controller = new AbortController(); api.me(controller.signal).then(async response => {
    if (cancelled) return; setViewer(response); const prior = savedConsoleContext(response.user_id)
    const tenants = [ ...response.tenants ].sort((left, right) => Number(right.id === prior.tenantId) - Number(left.id === prior.tenantId))
    for (const tenant of tenants) {
      const projects = await api.projects(tenant.id, controller.signal)
      const project = projects.items.find(item => item.id === prior.projectIds[tenant.id]) ?? projects.items[0]
      if (project) { if (!cancelled) { rememberConsoleContext(response.user_id, tenant.id, project.id); setContext({ tenant, project }) } return }
    }
  }).catch(value => { const error = value as ApiError; if (!cancelled && !(value instanceof DOMException) && error.code !== 'authentication_required') setError(error) }).finally(() => !cancelled && setLoading(false))
  return () => { cancelled = true; controller.abort() } }, [])
  if (loading) return <PageMessage title="正在加载工作台" />
  if (!viewer) return <Login error={error} onAuthenticated={() => location.reload()} />
  if (!context) return <ProjectOnboarding tenants={viewer.tenants} onCreated={(tenant, project) => { rememberConsoleContext(viewer.user_id, tenant.id, project.id); setContext({ tenant, project }); navigate('/') }} />
  const changeContext = (next: AppContext) => { rememberConsoleContext(viewer.user_id, next.tenant.id, next.project.id); setContext(next); navigate('/') }
  const updateProject = (project: Project) => { rememberConsoleContext(viewer.user_id, context.tenant.id, project.id); setContext({ tenant: context.tenant, project }) }
  return <Shell viewerId={viewer.user_id} tenants={viewer.tenants} context={context} onContext={changeContext} onLogout={async () => { await api.logout(); sessionStorage.removeItem('zj_console_context'); location.reload() }} route={route}><React.Fragment key={`${route.kind}:${location.search}`}>
    {route.kind === 'notFound' && <section><Header title="页面未找到" detail="这条控制台路径不存在，可以回到项目概览继续。" /><Empty title="没有找到对应页面" action={{ label: '返回项目概览', href: '/' }} /></section>}
    {route.kind === 'dashboard' && <Dashboard context={context} />}
    {route.kind === 'errors' && (route.groupId ? <ErrorDetailPage context={context} groupId={route.groupId} /> : <ErrorsPage context={context} />)}
    {route.kind === 'analytics' && <AnalyticsPage context={context} />}
    {route.kind === 'funnels' && <FunnelsPage context={context} />}
    {route.kind === 'retention' && <RetentionPage context={context} />}
    {route.kind === 'paths' && <PathsPage context={context} />}
    {route.kind === 'journeys' && <UserJourneysPage api={api} scope={{ tenantId: context.tenant.id, projectId: context.project.id }} />}
    {route.kind === 'performance' && (route.pageKey && route.metric ? <PerformanceDetailPage context={context} pageKey={route.pageKey} metric={route.metric} /> : <PerformancePage context={context} />)}
    {route.kind === 'heatmaps' && <HeatmapsPage context={context} />}
    {route.kind === 'replays' && (route.groupId ? <ReplayDetailPage context={context} sessionId={route.groupId} /> : <ReplaysPage context={context} />)}
    {route.kind === 'alerts' && <AlertsPage context={context} />}
    {route.kind === 'usage' && <UsagePage context={context} />}
    {route.kind === 'billing' && <BillingPage context={context} />}
    {route.kind === 'members' && <MembersPage context={context} viewerId={viewer.user_id} />}
    {route.kind === 'auditLogs' && <AuditLogsPage context={context} />}
    {route.kind === 'insights' && <InsightsPage context={context} />}
    {route.kind === 'dashboards' && <DashboardsPage context={context} />}
    {route.kind === 'reportSchedules' && <ReportSchedulesPage context={context} />}
    {route.kind === 'cohorts' && <CohortsPage context={context} />}
    {route.kind === 'exports' && <ExportsPage context={context} />}
    {route.kind === 'sourcemaps' && <SourceMapsPage context={context} />}
    {route.kind === 'lifecycle' && <LifecyclePage context={context} />}
    {route.kind === 'tenantSettings' && <TenantSettingsPage context={context} />}
    {route.kind === 'settings' && <ProjectSettingsPage context={context} onUpdated={updateProject} />}
    {route.kind === 'sdk' && <SdkIntegrationPage context={context} />}
  </React.Fragment></Shell>
}

function Login({ error, onAuthenticated }: { error: ApiError | null; onAuthenticated: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [failure, setFailure] = useState<ApiError | null>(error)
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setFailure(null); try { await api.login(email, password); onAuthenticated() } catch (value) { setFailure(value as ApiError); setBusy(false) } }
  return <main className="login"><div className="login-layout"><section className="login-story"><a className="brand-link" href="/" aria-label="知迹首页"><Brand /></a><p className="login-kicker">PRODUCT INTELLIGENCE</p><h1>看见异常，<br />读懂行为。</h1><p>从一次访问到一次故障，把关键线索留在同一个工作台。</p><ul><li>错误、性能与行为统一关联</li><li>按租户与项目严格隔离</li><li>采集数据始终可追溯</li></ul></section><form className="login-form" onSubmit={submit}><ConsoleCard className="login-card" variant="card"><div className="login-card-heading"><span aria-hidden="true" className="login-signal">⌁</span><div><p>欢迎回来</p><h2>登录管理台</h2></div></div><p className="login-hint">使用你的管理员账户继续。</p><label>邮箱<ConsoleInput type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="name@company.com" /></label><label>密码<ConsoleInput type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" placeholder="输入密码" /></label>{failure && <Problem error={failure} />}<ConsoleButton type="submit" className="login-submit" disabled={busy}>{busy ? '正在验证身份…' : '进入工作台'}<span aria-hidden="true">→</span></ConsoleButton><p className="login-footnote">登录表示你同意遵循本组织的数据访问与隐私规则。</p></ConsoleCard></form></div></main>
}

function ProjectOnboarding({ tenants, onCreated }: { tenants: Tenant[]; onCreated: (tenant: Tenant, project: Project) => void }) {
  const [tenantId, setTenantId] = useState(() => tenants.find(item => item.role === 'owner')?.id ?? tenants[0]?.id ?? '')
  const tenant = tenants.find(item => item.id === tenantId) ?? null
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiError | null>(null)
  const canCreate = tenant?.role === 'owner'
  async function submit(event: FormEvent) { event.preventDefault(); if (!tenant || !name.trim()) return; setBusy(true); setError(null); try { const result = await api.createProject(tenant.id, { name: name.trim() }); onCreated(tenant, result.project) } catch (value) { setError(value as ApiError) } finally { setBusy(false) } }
  return <main className="project-onboarding"><section><a className="brand-link" href="/" aria-label="知迹首页"><Brand /></a><p className="login-kicker">欢迎使用知迹 · 第一步</p><h1>{canCreate ? '先创建第一个项目' : '当前租户没有可创建项目权限'}</h1><p>{canCreate ? '项目是知迹的数据隔离边界。创建后即可生成 SDK Key，并按项目查看错误、性能和行为数据。' : '请选择拥有 Owner 权限的组织，或联系该组织所有者为你分配一个已有项目。'}</p>{tenants.length > 1 && <label>目标组织<ConsoleSelect value={tenantId} onChange={event => setTenantId(event.target.value)}>{tenants.map(item => <option key={item.id} value={item.id}>{item.name}（{roleLabel(item.role)}）</option>)}</ConsoleSelect></label>}{canCreate && <form onSubmit={submit}><label>项目名称<ConsoleInput required maxLength={200} value={name} onChange={event => setName(event.target.value)} placeholder="例如：官网、Web 应用或 iOS 客户端" /></label>{error && <Problem error={error} />}<ConsoleButton type="submit" disabled={busy}>{busy ? '正在创建…' : '创建项目并进入工作台'} <span aria-hidden="true">→</span></ConsoleButton></form>}</section><aside><span>从一个系统开始</span><h2>接入之后，<br />变化看得见。</h2><p>网站、服务端或移动应用，都可以单独创建项目。</p><ol className="onboarding-roadmap"><li><b>01 · 创建项目</b><span>给要接入的系统起一个名字。</span></li><li><b>02 · 配置接入</b><span>按系统类型配置来源和 Key。</span></li><li><b>03 · 验证数据</b><span>发送一个事件，确认知迹已收到。</span></li></ol><a href="/docs/quickstart">先看看接入文档 ↗</a></aside></main>
}

function savedConsoleContext(userId: string): SavedConsoleContext {
  const key = `zj_console_context:${userId}`
  try {
    const stored = localStorage.getItem(key)
    if (stored) {
      const parsed = JSON.parse(stored) as { tenantId?: unknown; projectIds?: unknown }
      const projectIds = parsed.projectIds && typeof parsed.projectIds === 'object'
        ? Object.fromEntries(Object.entries(parsed.projectIds).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : {}
      return { ...(typeof parsed.tenantId === 'string' ? { tenantId: parsed.tenantId } : {}), projectIds }
    }
  } catch { try { localStorage.removeItem(key) } catch {} }
  try {
    const legacy = sessionStorage.getItem('zj_console_context')
    if (legacy) {
      const parsed = JSON.parse(legacy) as { tenantId?: unknown; projectId?: unknown }
      if (typeof parsed.tenantId === 'string' && typeof parsed.projectId === 'string') {
        const migrated = { tenantId: parsed.tenantId, projectIds: { [parsed.tenantId]: parsed.projectId } }
        localStorage.setItem(key, JSON.stringify(migrated)); sessionStorage.removeItem('zj_console_context')
        return migrated
      }
    }
  } catch { try { sessionStorage.removeItem('zj_console_context') } catch {} }
  return { projectIds: {} }
}
function rememberConsoleContext(userId: string, tenantId: string, projectId: string) {
  const previous = savedConsoleContext(userId)
  try { localStorage.setItem(`zj_console_context:${userId}`, JSON.stringify({ tenantId, projectIds: { ...previous.projectIds, [tenantId]: projectId } })) } catch {
    try { sessionStorage.setItem('zj_console_context', JSON.stringify({ tenantId, projectId })) } catch {}
  }
}

function Shell({ children, viewerId, tenants, context, onContext, onLogout, route }: { children: ReactNode; viewerId: string; tenants: Tenant[]; context: AppContext; onContext: (value: AppContext) => void; onLogout: () => Promise<void>; route: Route }) {
  const [projects, setProjects] = useState<Project[]>([context.project])
  const [menuOpen, setMenuOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [shellError, setShellError] = useState<ApiError | null>(null)
  const requestVersion = useRef(0)
  const page = consolePageInfo(route.kind)
  useEffect(() => { const c = new AbortController(); setProjects([context.project]); api.projects(context.tenant.id, c.signal).then(x => setProjects(x.items)).catch(value => { if (!(value instanceof DOMException)) setShellError(value as ApiError) }); return () => c.abort() }, [context.tenant.id])
  useEffect(() => { setMenuOpen(false); document.title = `${page.label} · ${context.project.name} · 知迹`; }, [route.kind, route.groupId, context.project.name])
  useEffect(() => { if (!menuOpen) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); document.getElementById('console-menu-toggle')?.focus() } }; addEventListener('keydown', close); return () => removeEventListener('keydown', close) }, [menuOpen])
  const switchTenant = async (id: string) => {
    const tenant = tenants.find(value => value.id === id); if (!tenant) return
    const version = ++requestVersion.current; setSwitching(true); setShellError(null)
    try { const result = await api.projects(tenant.id); if (version !== requestVersion.current) return; const rememberedId = savedConsoleContext(viewerId).projectIds[tenant.id]; const project = result.items.find(item => item.id === rememberedId) ?? result.items[0]; if (project) onContext({ tenant, project }); else setShellError(new ApiError(404, 'no_projects', '该组织暂无可访问项目，请联系组织管理员。')) }
    catch (value) { if (version === requestVersion.current) setShellError(value as ApiError) }
    finally { if (version === requestVersion.current) setSwitching(false) }
  }
  return <div className={`console-root app${menuOpen ? ' navigation-open' : ''}`}>
    <a className="console-skip" href="#console-content">跳至正文</a>
    <aside>
      <div className="sidebar-brand-row"><a className="brand-link" href="/console" onClick={event => { if (event.metaKey || event.ctrlKey) return; event.preventDefault(); navigate('/') }}><Brand /><small>工作台</small></a><ConsoleButton id="console-menu-toggle" className="secondary console-menu-toggle" aria-expanded={menuOpen} aria-controls="console-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? '关闭菜单' : '菜单'} <span aria-hidden="true">{menuOpen ? '×' : '☰'}</span></ConsoleButton></div>
      <nav id="console-navigation" aria-label="管理台导航">{consoleGroups.map(group => group.items.length === 1 ? <Nav key={group.title} href="/" active={route.kind === 'dashboard'}><span className="nav-icon" aria-hidden="true">◫</span>项目概览</Nav> : <NavSection key={group.title} title={group.title} open={group.items.some(item => item.kind === route.kind)}>{group.items.map(item => <Nav key={item.kind} href={item.href} active={route.kind === item.kind}><span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}</Nav>)}</NavSection>)}</nav>
      <div className="sidebar-bottom"><a className="sidebar-help" href="/docs"><span aria-hidden="true">↗</span><span>接入与使用文档<small>从第一条事件开始</small></span></a><div className="account"><strong title={viewerId}>{roleLabel(context.tenant.role)}</strong><ConsoleButton className="link" onClick={() => void onLogout().catch(value => setShellError(value as ApiError))}>退出登录</ConsoleButton></div></div>
    </aside>
    <main className="workspace"><header className="console-topbar"><div className="console-breadcrumb"><span>{page.category}</span><span aria-hidden="true">/</span><strong>{page.label}</strong></div><div className="context-strip"><label><span>组织</span><ConsoleSelect aria-label="切换租户" disabled={switching} value={context.tenant.id} onChange={event => void switchTenant(event.target.value)}>{tenants.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</ConsoleSelect></label><label><span>项目</span><ConsoleSelect aria-label="切换项目" disabled={switching} value={context.project.id} onChange={event => { const project = projects.find(item => item.id === event.target.value); if (project) onContext({ tenant: context.tenant, project }) }}>{projects.map(item => <option key={item.id} value={item.id}>{item.id === context.project.id ? context.project.name : item.name}</option>)}</ConsoleSelect></label><span className="context-role">{roleLabel(context.tenant.role)}</span></div></header>
      {shellError && <Problem error={shellError} />}
      <div id="console-content" className="console-page" key={`${context.tenant.id}:${context.project.id}:${route.kind}:${route.groupId ?? route.pageKey ?? ''}`} tabIndex={-1}>{children}</div>
      <footer className="console-footer"><span>知迹 · {context.project.name}</span><a href="/docs/privacy">数据与采集边界 ↗</a></footer>
    </main>
  </div>
}

function NavSection({ title, open, children }: { title: string; open: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(() => open && !matchMedia('(max-width:720px)').matches)
  useEffect(() => {
    const media = matchMedia('(max-width:720px)')
    const sync = () => setExpanded(media.matches ? false : open)
    const closeOtherSections = (event: Event) => { if ((event as CustomEvent<string>).detail !== title) setExpanded(false) }
    sync()
    media.addEventListener('change', sync)
    addEventListener('popstate', sync)
    addEventListener('console-nav-section', closeOtherSections)
    return () => { media.removeEventListener('change', sync); removeEventListener('popstate', sync); removeEventListener('console-nav-section', closeOtherSections) }
  }, [open])
  return <details className="nav-section" open={expanded} onToggle={event => { setExpanded(event.currentTarget.open); if (event.currentTarget.open) dispatchEvent(new CustomEvent('console-nav-section', { detail: title })) }}><summary><span className="nav-section-title">{title}</span><span className="nav-section-chevron" aria-hidden="true">⌄</span></summary><div>{children}</div></details>
}
function Nav({ href, active, children }: { href: string; active: boolean; children: ReactNode }) { return <a className={active ? 'active' : ''} aria-current={active ? "page" : undefined} href={`/console${href === "/" ? "" : href}`} onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); navigate(href) }}>{children}</a> }

function Dashboard({ context }: { context: AppContext }) {
  const [verification, setVerification] = useState(0)
  const [data, setData] = useState<ProjectDashboard | null>(null); const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => { const controller = new AbortController(); setData(null); setError(null); const query = rangeQuery(7); query.set('granularity', 'day'); api.projectDashboard(context.tenant.id, context.project.id, query, controller.signal).then(setData).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) }); return () => controller.abort() }, [context.tenant.id, context.project.id, verification])
  if (error) return <section><Header title="项目概览" detail="最近 7 天数据" /><Problem error={error} /></section>
  if (!data) return <section><Header title="项目概览" detail="最近 7 天数据" /><Loading /></section>
  const hasData = Object.values(data.summary).some(value => value > 0) || data.error_top10.length > 0
  if (!hasData) return <section><Header title="项目概览" detail={verification ? '已重新检查，最近 7 天仍未收到数据' : '项目已创建，开始接入你的系统'} /><ConnectionGuide api={api} tenant={context.tenant} project={context.project} navigate={navigate} onVerify={() => setVerification(value => value + 1)} /></section>
  return <section><Header title="项目概览" detail="最近 7 天已接收的聚合数据" /><div className="metric-grid"><Metric label="页面浏览" value={number(data.summary.pv)} /><Metric label="访客" value={number(data.summary.visitors)} /><Metric label="业务用户" value={number(data.summary.business_users)} /><Metric label="事件" value={number(data.summary.event_count)} /><Metric label="未解决错误" value={number(data.summary.unresolved_errors)} /></div><Trend context={context} compact /><ConsoleCard className="panel"><h2>最近未解决错误</h2>{data.error_top10.length ? <Table headers={['错误', '已接收次数', '最近发生']} rows={data.error_top10.map(item => [item.title, number(item.occurrence_count), formatTime(item.last_seen)])} /> : <Empty title="暂无未解决错误" />}</ConsoleCard></section>
}
function Metric({ label, value }: { label: string; value: string }) { return <ConsoleStatCard className="panel metric" label={label} value={value} size="lg" /> }
function AnalyticsPage({ context }: { context: AppContext }) { return <section><Header title="分析" detail="按事件和时间维度查看趋势" /><Trend context={context} /><EventExplorer context={context} /></section> }
function EventExplorer({ context }: { context: AppContext }) {
  const [days, setDays] = useState<7 | 30 | 90>(() => daysQuery('days', 7)); const [name, setName] = useState(() => queryValue('event')); const [groupBy, setGroupBy] = useState<'name' | 'route' | 'release'>(() => groupQuery()); const [result, setResult] = useState<EventExplorerResult | null>(null); const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => { const controller = new AbortController(); setResult(null); setError(null); const query = rangeQuery(days); query.set('filters', '[]'); query.set('group_by', groupBy); if (name.trim()) query.set('name', name.trim()); api.eventExplorer(context.tenant.id, context.project.id, query, controller.signal).then(setResult).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) }); return () => controller.abort() }, [context.tenant.id, context.project.id, days, name, groupBy])
  const update = (next: { days?: 7 | 30 | 90; name?: string; groupBy?: 'name' | 'route' | 'release' }) => replaceConsoleQuery({ days: String(next.days ?? days), event: (next.name ?? name).trim() || undefined, group_by: next.groupBy ?? groupBy })
  return <ConsoleCard className="panel"><h2>事件浏览</h2><div className="funnel-controls"><label>范围<ConsoleSelect value={days} onChange={event => { const value = Number(event.target.value) as 7 | 30 | 90; setDays(value); update({ days: value }) }}><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option></ConsoleSelect></label><label>事件名（可选）<ConsoleInput maxLength={200} value={name} onChange={event => { setName(event.target.value); update({ name: event.target.value }) }} /></label><label>分组<ConsoleSelect value={groupBy} onChange={event => { const value = event.target.value as 'name' | 'route' | 'release'; setGroupBy(value); update({ groupBy: value }) }}><option value="name">事件名</option><option value="route">页面</option><option value="release">版本</option></ConsoleSelect></label></div><p className="help">筛选条件保存在当前地址，可刷新或复制链接继续查看。只显示聚合计数，不提供原始事件或身份明细。</p>{error ? <Problem error={error} /> : !result ? <Loading /> : result.items.length ? <Table headers={['分组', '事件数']} rows={result.items.map(item => [item.value, number(item.count)])} /> : <Empty title="还没有分析事件" detail="接入 SDK 后，页面浏览和自定义事件会按当前项目汇总。" action={{ label: '前往 SDK 接入', href: '/sdk' }} />}</ConsoleCard>
}
function FunnelsPage({ context }: { context: AppContext }) {
  const [steps, setSteps] = useState(() => listQuery('steps', ['page_view', 'signup'], 2, 5))
  const [subjectKind, setSubjectKind] = useState<FunnelSubjectKind>(() => subjectQuery())
  const [days, setDays] = useState<7 | 30 | 90>(() => daysQuery('days', 7))
  const [result, setResult] = useState<FunnelResult | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [submitted, setSubmitted] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const query = rangeQuery(days); query.set('steps', steps.join(',')); query.set('subject_kind', subjectKind)
    api.funnel(context.tenant.id, context.project.id, query, controller.signal).then(setResult).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) })
    return () => controller.abort()
  }, [context, days, subjectKind, submitted])
  const setStep = (index: number, value: string) => setSteps(current => current.map((step, currentIndex) => currentIndex === index ? value : step))
  const submit = (event: FormEvent) => { event.preventDefault(); const normalized = steps.map(step => step.trim()); if (normalized.some(step => !step)) return; setSteps(normalized); pushConsoleQuery({ days: String(days), subject: subjectKind, steps: normalized.join(',') }); setError(null); setResult(null); setSubmitted(current => current + 1) }
  return <section><Header title="漏斗分析" detail="按同一访客或已关联业务用户，计算顺序完成各事件的人数。" /><form className="funnel-form panel" onSubmit={submit}><div className="funnel-controls"><label>统计范围<ConsoleSelect value={days} onChange={event => setDays(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option></ConsoleSelect></label><label>统计主体<ConsoleSelect value={subjectKind} onChange={event => setSubjectKind(event.target.value as FunnelSubjectKind)}><option value="visitor">访客</option><option value="business_user">业务用户（关联后的所有归属）</option></ConsoleSelect></label></div><div className="funnel-steps"><h2>步骤（2–5 个）</h2>{steps.map((step, index) => <div className="funnel-step-input" key={index}><span>{index + 1}</span><label>事件名<ConsoleInput value={step} onChange={event => setStep(index, event.target.value)} maxLength={200} required /></label>{steps.length > 2 && <ConsoleButton type="button" className="secondary" aria-label={`删除第 ${index + 1} 步`} onClick={() => setSteps(current => current.filter((_, currentIndex) => currentIndex !== index))}>删除</ConsoleButton>}</div>)}{steps.length < 5 && <ConsoleButton type="button" className="secondary" onClick={() => setSteps(current => [...current, ''])}>添加步骤</ConsoleButton>}</div><div className="actions"><ConsoleButton type="submit">计算漏斗</ConsoleButton></div></form>{error ? <Problem error={error} /> : !result ? <Loading /> : <FunnelResults result={result} />}</section>
}
function FunnelResults({ result }: { result: FunnelResult }) {
  return <ConsoleCard className="panel funnel-results"><div className="funnel-summary"><span>来源事件 {number(result.source_event_count)}</span><span>{result.subject_kind === 'visitor' ? '按访客去重' : '按关联业务用户去重'}</span><span>UTC</span></div>{result.source_event_count === 0 ? <Empty title="还没有可计算的事件" detail="完成 SDK 接入并上报漏斗步骤事件后，这里会显示转化和流失。" action={{ label: '前往 SDK 接入', href: '/sdk' }} /> : <><FunnelChart steps={result.steps} /><Table headers={['步骤', '事件', '完成人数', '本步转化', '流失']} rows={result.steps.map((step, index) => [index + 1, step.name, number(step.count), `${step.conversion.toFixed(2)}%`, number(step.dropoff)])} /></>}</ConsoleCard>
}
function AnalyticsRange({ days, onDays, subjectKind, onSubjectKind }: { days: 7 | 30 | 90; onDays: (value: 7 | 30 | 90) => void; subjectKind: FunnelSubjectKind; onSubjectKind: (value: FunnelSubjectKind) => void }) {
  return <div className="funnel-controls"><label>统计范围<ConsoleSelect value={days} onChange={event => onDays(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option></ConsoleSelect></label><label>统计主体<ConsoleSelect value={subjectKind} onChange={event => onSubjectKind(event.target.value as FunnelSubjectKind)}><option value="visitor">访客</option><option value="business_user">业务用户（关联后的所有归属）</option></ConsoleSelect></label></div>
}
function RetentionPage({ context }: { context: AppContext }) {
  const [startEvent, setStartEvent] = useState(() => queryValue('start_event', 'page_view')); const [returnEvent, setReturnEvent] = useState(() => queryValue('return_event', 'page_view'))
  const [period, setPeriod] = useState<RetentionPeriod>(() => periodQuery()); const [periodCount, setPeriodCount] = useState<1 | 3 | 7 | 12>(() => periodCountQuery())
  const [days, setDays] = useState<7 | 30 | 90>(() => daysQuery('days', 30)); const [subjectKind, setSubjectKind] = useState<FunnelSubjectKind>(() => subjectQuery())
  const [result, setResult] = useState<RetentionResult | null>(null); const [error, setError] = useState<ApiError | null>(null); const [submitted, setSubmitted] = useState(0)
  useEffect(() => { const controller = new AbortController(); const query = rangeQuery(days); query.set('start_event', startEvent); query.set('return_event', returnEvent); query.set('period', period); query.set('period_count', String(periodCount)); query.set('subject_kind', subjectKind); query.set('timezone', browserTimezone()); api.retention(context.tenant.id, context.project.id, query, controller.signal).then(setResult).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) }); return () => controller.abort() }, [context, days, subjectKind, submitted])
  const submit = (event: FormEvent) => { event.preventDefault(); const start = startEvent.trim(); const returned = returnEvent.trim(); if (!start || !returned) return; setStartEvent(start); setReturnEvent(returned); pushConsoleQuery({ days: String(days), subject: subjectKind, start_event: start, return_event: returned, period, period_count: String(periodCount) }); setError(null); setResult(null); setSubmitted(value => value + 1) }
  return <section><Header title="留存分析" detail="以首次触发起始事件的主体为 cohort，按后续周期是否触发回访事件计算留存。" /><form className="funnel-form panel" onSubmit={submit}><AnalyticsRange days={days} onDays={setDays} subjectKind={subjectKind} onSubjectKind={setSubjectKind} /><div className="funnel-controls"><label>起始事件<ConsoleInput required maxLength={200} value={startEvent} onChange={event => setStartEvent(event.target.value)} /></label><label>回访事件<ConsoleInput required maxLength={200} value={returnEvent} onChange={event => setReturnEvent(event.target.value)} /></label><label>周期<ConsoleSelect value={period} onChange={event => setPeriod(event.target.value as RetentionPeriod)}><option value="day">按天</option><option value="week">按周</option><option value="month">按月</option></ConsoleSelect></label><label>展示周期数<ConsoleSelect value={periodCount} onChange={event => setPeriodCount(Number(event.target.value) as 1 | 3 | 7 | 12)}><option value={1}>1 期</option><option value={3}>3 期</option><option value={7}>7 期</option><option value={12}>12 期</option></ConsoleSelect></label></div><p className="help">查询范围最长 90 天，时区使用当前浏览器时区。只展示聚合人数与比例。</p><div className="actions"><ConsoleButton type="submit">计算留存</ConsoleButton></div></form>{error ? <Problem error={error} /> : !result ? <Loading /> : <RetentionResults result={result} />}</section>
}
function RetentionResults({ result }: { result: RetentionResult }) {
  const headers = ['Cohort', '起始人数', ...Array.from({ length: result.period_count }, (_, index) => `第 ${index + 1} 期`)]
  return <ConsoleCard className="panel funnel-results"><div className="funnel-summary"><span>来源事件 {number(result.source_event_count)}</span><span>{result.subject_kind === 'visitor' ? '按访客去重' : '按关联业务用户去重'}</span><span>{periodLabel(result.period)} · {result.timezone}</span></div>{!result.cohorts.length ? <Empty title="该范围内没有符合条件的 cohort" detail="请确认事件名与统计范围后重试。" /> : <Table headers={headers} rows={result.cohorts.map(cohort => [formatDate(cohort.cohort_start), number(cohort.cohort_size), ...cohort.retained.map(item => `${number(item.count)} (${item.rate.toFixed(2)}%)`)])} />}</ConsoleCard>
}
function PathsPage({ context }: { context: AppContext }) {
  const [startEvent, setStartEvent] = useState(() => queryValue('start_event', 'page_view')); const [depth, setDepth] = useState<2 | 3 | 4 | 5>(() => depthQuery()); const [days, setDays] = useState<7 | 30 | 90>(() => daysQuery('days', 30)); const [subjectKind, setSubjectKind] = useState<FunnelSubjectKind>(() => subjectQuery())
  const [result, setResult] = useState<PathResult | null>(null); const [error, setError] = useState<ApiError | null>(null); const [submitted, setSubmitted] = useState(0)
  useEffect(() => { const controller = new AbortController(); const query = rangeQuery(days); query.set('start_event', startEvent); query.set('depth', String(depth)); query.set('subject_kind', subjectKind); api.pathAnalysis(context.tenant.id, context.project.id, query, controller.signal).then(setResult).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) }); return () => controller.abort() }, [context, days, subjectKind, submitted])
  const submit = (event: FormEvent) => { event.preventDefault(); const normalized = startEvent.trim(); if (!normalized) return; setStartEvent(normalized); pushConsoleQuery({ days: String(days), subject: subjectKind, start_event: normalized, depth: String(depth) }); setError(null); setResult(null); setSubmitted(value => value + 1) }
  return <section><Header title="路径分析" detail="从每个主体首次触发的起始事件开始，展示后续事件的聚合路径；单个节点最多展示前 10 个分支。" /><form className="funnel-form panel" onSubmit={submit}><AnalyticsRange days={days} onDays={setDays} subjectKind={subjectKind} onSubjectKind={setSubjectKind} /><div className="funnel-controls"><label>起始事件<ConsoleInput required maxLength={200} value={startEvent} onChange={event => setStartEvent(event.target.value)} /></label><label>路径深度<ConsoleSelect value={depth} onChange={event => setDepth(Number(event.target.value) as 2 | 3 | 4 | 5)}><option value={2}>2 层</option><option value={3}>3 层</option><option value={4}>4 层</option><option value={5}>5 层</option></ConsoleSelect></label></div><p className="help">页面浏览使用已采集的页面路径，其他事件使用事件名。页面文本、用户标识与原始事件属性不会在此展示。</p><div className="actions"><ConsoleButton type="submit">计算路径</ConsoleButton></div></form>{error ? <Problem error={error} /> : !result ? <Loading /> : <PathResults result={result} />}</section>
}
function PathResults({ result }: { result: PathResult }) {
  const rows = result.levels.flatMap(level => level.nodes.map(node => [level.depth, node.parent_path.length ? node.parent_path.join(' → ') : '起始事件', node.name, number(node.count)] as ReactNode[]).concat(level.other_count ? [[level.depth, '各父路径的其余分支', '其他', number(level.other_count)]] : []))
  return <ConsoleCard className="panel funnel-results"><div className="funnel-summary"><span>来源事件 {number(result.source_event_count)}</span><span>{result.subject_kind === 'visitor' ? '按访客去重' : '按关联业务用户去重'}</span><span>最多 {result.depth} 层</span></div>{rows.length ? <Table headers={['层级', '前置路径', '下一步', '主体数']} rows={rows} /> : <Empty title="该范围内没有后续路径" detail="起始事件后的下一次不同事件会出现在这里。" />}</ConsoleCard>
}

function CohortsPage({ context }: { context: AppContext }) {
  const [items, setItems] = useState<Cohort[] | null>(null); const [editing, setEditing] = useState<Cohort | null>(null); const [creating, setCreating] = useState(false); const [preview, setPreview] = useState<CohortPreview | null>(null); const [error, setError] = useState<ApiError | null>(null)
  const load = () => api.cohorts(context.tenant.id, context.project.id).then(result => setItems(result.items)).catch(value => setError(value as ApiError))
  useEffect(() => { setItems(null); setEditing(null); setCreating(false); setPreview(null); setError(null); void load() }, [context.tenant.id, context.project.id])
  const remove = async (item: Cohort) => { try { await api.archiveCohort(context.tenant.id, context.project.id, item.id, item.definition_version); setItems(current => current?.filter(value => value.id !== item.id) ?? null); if (preview?.cohort_id === item.id) setPreview(null) } catch (value) { setError(value as ApiError) } }
  const inspect = async (item: Cohort) => { setPreview(null); setError(null); try { setPreview(await api.previewCohort(context.tenant.id, context.project.id, item.id)) } catch (value) { setError(value as ApiError) } }
  return <section><Header title="用户分群" detail="分群只返回去重后的聚合人数，不提供成员名单、标识符或原始事件属性。" actions={<ConsoleButton onClick={() => { setEditing(null); setCreating(true) }}>新建分群</ConsoleButton>} />{error && <Problem error={error} />}{creating && <CohortEditor context={context} initial={null} onCancel={() => setCreating(false)} onSaved={item => { setItems(current => [item, ...(current ?? [])]); setCreating(false) }} />}{editing && <CohortEditor context={context} initial={editing} onCancel={() => setEditing(null)} onSaved={item => { setItems(current => current?.map(value => value.id === item.id ? item : value) ?? [item]); setEditing(null) }} />}{preview && <ConsoleCard className="panel"><h2>分群预览</h2><p><strong>{number(preview.snapshot.member_count)}</strong> 个去重主体 · {preview.snapshot.subject_kind === 'visitor' ? '访客' : '业务用户'} · {formatTime(preview.snapshot.range_from)} 至 {formatTime(preview.snapshot.range_to)}</p><p className="help">快照有效至 {formatTime(preview.snapshot.expires_at)}。所有已关联归属会合并计算，事实不会因关联关系重复计数。</p></ConsoleCard>}{!items ? <Loading /> : !items.length ? <Empty title="尚未创建分群" detail="分群适合重复使用的、受限条件的聚合分析。" /> : <Table headers={['名称', '条件', '主体', '范围', '版本', '操作']} rows={items.map(item => [<span key="name"><strong>{item.name}</strong>{item.description && <small className="muted">{item.description}</small>}</span>, `${item.definition.event_name} ≥ ${item.definition.min_occurrences}${item.definition.max_occurrences ? `，≤ ${item.definition.max_occurrences}` : ''}`, item.subject_kind === 'visitor' ? '访客' : '业务用户', item.definition.window.kind === 'relative' ? `最近 ${item.definition.window.days} 天` : `${formatDate(item.definition.window.from)} 至 ${formatDate(item.definition.window.to)}`, item.definition_version, <span className="key-actions" key="actions"><ConsoleButton className="secondary" onClick={() => void inspect(item)}>预览人数</ConsoleButton><ConsoleButton className="secondary" onClick={() => { setCreating(false); setEditing(item) }}>编辑</ConsoleButton><ConfirmAction label="归档" title={`归档分群「${item.name}」？`} impact="它会从分群列表和后续选择中移除；已经生成的聚合快照不会恢复为成员名单。" confirmLabel="确认归档" onConfirm={() => void remove(item)} /></span>])} />}</section>
}
function CohortEditor({ context, initial, onCancel, onSaved }: { context: AppContext; initial: Cohort | null; onCancel: () => void; onSaved: (item: Cohort) => void }) {
  const definition = initial?.definition; const [name, setName] = useState(initial?.name ?? ''); const [description, setDescription] = useState(initial?.description ?? ''); const [visibility, setVisibility] = useState<InsightVisibility>(initial?.visibility ?? 'private'); const [subjectKind, setSubjectKind] = useState<FunnelSubjectKind>(initial?.subject_kind ?? 'visitor'); const [eventName, setEventName] = useState(definition?.event_name ?? 'page_view'); const [minimum, setMinimum] = useState(String(definition?.min_occurrences ?? 1)); const [maximum, setMaximum] = useState(definition?.max_occurrences === undefined ? '' : String(definition.max_occurrences)); const [days, setDays] = useState(String(definition?.window.kind === 'relative' ? definition.window.days : 30)); const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiError | null>(null)
  const submit = async (event: FormEvent) => { event.preventDefault(); const min = Number(minimum); const max = maximum === '' ? undefined : Number(maximum); const windowDays = Number(days); const normalized = name.trim(); const normalizedEvent = eventName.trim(); if (!normalized || !normalizedEvent || !Number.isSafeInteger(min) || min < 1 || !Number.isSafeInteger(windowDays) || windowDays < 1 || windowDays > 90 || (max !== undefined && (!Number.isSafeInteger(max) || max < min))) return; const cohortDefinition: CohortDefinition = { schema_version: 1, event_name: normalizedEvent, min_occurrences: min, ...(max === undefined ? {} : { max_occurrences: max }), window: { kind: 'relative', days: windowDays }, ...(definition?.property_filters?.length ? { property_filters: definition.property_filters } : {}) }; const body = { name: normalized, description: description.trim() || null, visibility, subject_kind: subjectKind, definition: cohortDefinition }; setBusy(true); setError(null); try { const saved = initial ? await api.updateCohort(context.tenant.id, context.project.id, initial.id, { ...body, expected_definition_version: initial.definition_version }) : await api.createCohort(context.tenant.id, context.project.id, body); onSaved(saved) } catch (value) { setError(value as ApiError) } finally { setBusy(false) } }
  return <form className="panel funnel-form" onSubmit={submit}><h2>{initial ? '编辑分群' : '新建分群'}</h2><label>名称<ConsoleInput required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label><label>说明（可选）<ConsoleInput maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label><div className="funnel-controls"><label>可见范围<ConsoleSelect value={visibility} onChange={event => setVisibility(event.target.value as InsightVisibility)}><option value="private">仅自己</option><option value="project">项目成员</option></ConsoleSelect></label><label>统计主体<ConsoleSelect value={subjectKind} onChange={event => setSubjectKind(event.target.value as FunnelSubjectKind)}><option value="visitor">访客</option><option value="business_user">业务用户（所有关联归属）</option></ConsoleSelect></label><label>事件名<ConsoleInput required maxLength={200} value={eventName} onChange={event => setEventName(event.target.value)} /></label><label>最近天数<ConsoleInput required type="number" min="1" max="90" value={days} onChange={event => setDays(event.target.value)} /></label><label>至少触发次数<ConsoleInput required type="number" min="1" max="10000" value={minimum} onChange={event => setMinimum(event.target.value)} /></label><label>最多触发次数（可选）<ConsoleInput type="number" min="1" max="10000" value={maximum} onChange={event => setMaximum(event.target.value)} /></label></div>{definition?.property_filters?.length ? <p className="help">此分群已有 {definition.property_filters.length} 个属性条件，编辑时会原样保留。</p> : null}<p className="help">当前编辑器创建相对时间范围。服务端会校验全部条件与版本，预览只显示聚合人数。</p>{error && <Problem error={error} />}<div className="actions"><ConsoleButton type="submit" disabled={busy}>{busy ? '正在保存…' : '保存'}</ConsoleButton><ConsoleButton type="button" className="secondary" onClick={onCancel}>取消</ConsoleButton></div></form>
}
function ExportsPage({ context }: { context: AppContext }) {
  const [insights, setInsights] = useState<SavedInsight[] | null>(null); const [dashboards, setDashboards] = useState<SavedDashboard[] | null>(null); const [targetType, setTargetType] = useState<'insight' | 'dashboard'>('insight'); const [targetId, setTargetId] = useState(''); const [format, setFormat] = useState<'csv' | 'xlsx'>('csv'); const [job, setJob] = useState<AnalyticsExport | null>(null); const [error, setError] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false)
  useEffect(() => { const controller = new AbortController(); setInsights(null); setDashboards(null); setJob(null); setError(null); Promise.all([api.insights(context.tenant.id, context.project.id, controller.signal), api.dashboards(context.tenant.id, context.project.id, controller.signal)]).then(([i, d]) => { setInsights(i.items); setDashboards(d.items); setTargetId(i.items[0]?.id ?? d.items[0]?.id ?? '') }).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) }); return () => controller.abort() }, [context.tenant.id, context.project.id])
  const targets = targetType === 'insight' ? insights ?? [] : dashboards ?? []
  useEffect(() => { if (!targets.some(target => target.id === targetId)) setTargetId(targets[0]?.id ?? '') }, [targetType, insights, dashboards])
  useEffect(() => { if (!job || !['queued', 'running'].includes(job.status)) return; const timer = window.setTimeout(() => api.analyticsExport(context.tenant.id, context.project.id, job.id).then(setJob).catch(value => setError(value as ApiError)), 3000); return () => window.clearTimeout(timer) }, [context.tenant.id, context.project.id, job?.id, job?.status])
  const create = async (event: FormEvent) => { event.preventDefault(); if (!targetId || (targetType === 'dashboard' && format !== 'xlsx')) return; setBusy(true); setError(null); try { const created = await api.createAnalyticsExport(context.tenant.id, context.project.id, { format, target: { type: targetType, id: targetId } }); setJob(await api.analyticsExport(context.tenant.id, context.project.id, created.job_id)) } catch (value) { setError(value as ApiError) } finally { setBusy(false) } }
  const cancel = async () => { if (!job) return; setBusy(true); try { await api.cancelAnalyticsExport(context.tenant.id, context.project.id, job.id); setJob(await api.analyticsExport(context.tenant.id, context.project.id, job.id)) } catch (value) { setError(value as ApiError) } finally { setBusy(false) } }
  const download = async () => { if (!job) return; setBusy(true); setError(null); try { const file = await api.downloadAnalyticsExport(context.tenant.id, context.project.id, job.id); const url = URL.createObjectURL(file.blob); const link = document.createElement('a'); link.href = url; link.download = `zhiji-analytics.${file.format}`; link.click(); URL.revokeObjectURL(url) } catch (value) { setError(value as ApiError) } finally { setBusy(false) } }
  return <section><Header title="分析导出" detail="导出只支持保存洞察或仪表盘的受限聚合定义，不支持 SQL、原始事件或成员明细。" />{error && <Problem error={error} />}<form className="panel funnel-form" onSubmit={create}><h2>创建导出任务</h2><div className="funnel-controls"><label>导出内容<ConsoleSelect value={targetType} onChange={event => { const type = event.target.value as 'insight' | 'dashboard'; setTargetType(type); setFormat(type === 'dashboard' ? 'xlsx' : 'csv') }}><option value="insight">保存洞察</option><option value="dashboard">仪表盘</option></ConsoleSelect></label><label>目标<ConsoleSelect required value={targetId} onChange={event => setTargetId(event.target.value)}>{targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</ConsoleSelect></label><label>格式<ConsoleSelect value={format} disabled={targetType === 'dashboard'} onChange={event => setFormat(event.target.value as 'csv' | 'xlsx')}><option value="csv">CSV</option><option value="xlsx">XLSX</option></ConsoleSelect></label></div><p className="help">文件只在服务端私有存储可用时生成，并在到期后失效。下载令牌只在当前请求中使用，不会写入页面状态、地址栏或浏览器存储。</p><ConsoleButton type="submit" disabled={busy || !targetId}>{busy ? '正在创建…' : '创建导出任务'}</ConsoleButton></form>{job && <ConsoleCard className="panel"><h2>当前导出任务</h2><p>状态：<strong>{exportStatus(job.status)}</strong> · 格式：{job.format.toUpperCase()} · 创建于 {formatTime(job.created_at)}</p>{job.status === 'completed' ? <><p className="help">文件在 {formatTime(job.expires_at)} 后不可用；下载后令牌立即失效。</p><ConsoleButton disabled={busy} onClick={() => void download()}>{busy ? '正在下载…' : '下载文件'}</ConsoleButton></> : ['queued', 'running'].includes(job.status) ? <ConsoleButton className="secondary" disabled={busy} onClick={() => void cancel()}>{busy ? '正在取消…' : '取消任务'}</ConsoleButton> : <p className="help">{job.error_code === 'export_artifact_store_unavailable' ? '导出存储未配置，文件不可用。' : `任务未生成文件${job.error_code ? `（${job.error_code}）` : ''}。`}</p>}</ConsoleCard>}</section>
}
function exportStatus(status: AnalyticsExport['status']) { return ({ queued: '排队中', running: '生成中', completed: '已完成', failed: '失败', cancelled: '已取消', expired: '已过期' })[status] }
function PerformancePage({ context }: { context: AppContext }) {
  const [items, setItems] = useState<PerformanceMetric[] | null>(null); const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => { const c = new AbortController(); api.performance(context.tenant.id, context.project.id, rangeQuery(7), c.signal).then(x => setItems(x.items)).catch(x => { if (!(x instanceof DOMException)) setError(x as ApiError) }); return () => c.abort() }, [context])
  if (error) return <section><Header title="性能" detail="最近 7 天 Web Vitals" /><Problem error={error} /></section>
  if (!items) return <Loading />
  if (!items.length) return <section><Header title="性能" detail="最近 7 天 Web Vitals" /><Empty title="还没有性能数据" detail="先在项目设置中开启性能采集，再按 SDK 接入说明启用 Web Vitals。" action={{ label: '配置采集策略', href: '/settings' }} /></section>
  const rows = items.map(item => { const pageKey = item.page_key; const detail = pageKey ? <a key="detail" className="table-link" href={`/console/performance/${encodeURIComponent(pageKey)}?metric=${item.metric_name}`} onClick={event => { event.preventDefault(); navigate(`/performance/${encodeURIComponent(pageKey)}?metric=${item.metric_name}`) }}>查看详情</a> : '—'; return [item.metric_name, pageKey ?? '—', item.release ?? '—', number(item.sample_count), formatMetric(item), rate(item), detail] })
  return <section><Header title="性能" detail="最近 7 天 Web Vitals，按页面与版本聚合。详情仅显示受限聚合，不显示访客、业务用户或原始路由。" /><Table headers={['指标', '页面', '版本', '样本', 'P75', '良好率', '操作']} rows={rows} /></section>
}
function PerformanceDetailPage({ context, pageKey, metric }: { context: AppContext; pageKey: string; metric: PerformanceMetric['metric_name'] }) {
  const [detail, setDetail] = useState<PerformanceDetail | null>(null); const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => { const controller = new AbortController(); setDetail(null); setError(null); const query = rangeQuery(30); query.set('metric', metric); api.performanceDetail(context.tenant.id, context.project.id, pageKey, query, controller.signal).then(setDetail).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) }); return () => controller.abort() }, [context.tenant.id, context.project.id, pageKey, metric])
  const title = `${metric} · ${pageKey}`
  if (error) return <section><Header title="性能详情" detail={title} /><Problem error={error} /></section>
  if (!detail) return <Loading />
  return <section><Header title="性能详情" detail={`${title} · ${formatDate(detail.from)} 至 ${formatDate(detail.to)}（UTC）`} /><div className="actions"><a className="secondary button-like" href="/console/performance" onClick={event => { event.preventDefault(); navigate('/performance') }}>返回性能概览</a></div><ConsoleCard className="panel performance-scope"><p><strong>统计口径：</strong>按同一受控页面键、指标和 UTC 日聚合。hard 包含 navigate、reload、back_forward、prerender；soft 为 soft_navigation。</p><p>小样本波动不代表版本回归；请结合样本量与导航范围判断。</p></ConsoleCard><h2>页面版本（release）对比</h2>{detail.page_versions.length ? <Table headers={['页面版本', '样本', 'P50', 'P75', 'P95', '良好率']} rows={detail.page_versions.map(version => [version.release ?? '未标记', number(version.sample_count), formatPerformanceValue(metric, version.p50), formatPerformanceValue(metric, version.p75), formatPerformanceValue(metric, version.p95), rate(version)])} /> : <Empty title="暂无该页面指标" detail="当前范围内没有可比较的页面版本聚合。" />}<h2>每日趋势</h2>{detail.points.length ? <Table headers={['UTC 日期', '页面版本', '导航范围', '样本', 'P75', '良好率']} rows={detail.points.map(point => [formatDate(point.bucket_start), point.release ?? '未标记', point.navigation_scope === 'soft' ? 'soft navigation' : 'hard navigation', number(point.sample_count), formatPerformanceValue(metric, point.p75), rate(point)])} /> : <Empty title="暂无趋势数据" detail="性能详情不会回退展示原始观测或身份数据。" />}</section>
}
function rate(metric: Pick<PerformanceMetric, 'sample_count' | 'good_count'>) { return metric.sample_count > 0 ? `${Math.round(metric.good_count / metric.sample_count * 100)}%` : '—' }
function formatPerformanceValue(metric: PerformanceMetric['metric_name'], value: number | null) { if (value === null) return '—'; return metric === 'CLS' ? value.toFixed(3) : `${Math.round(value)} ms` }
function UsagePage({ context }: { context: AppContext }) {
  const [days, setDays] = useState<7 | 30 | 90>(30); const [lane, setLane] = useState<UsageDaily['lane'] | ''>('')
  const [report, setReport] = useState<UsageReport | null>(null); const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => { const controller = new AbortController(); setReport(null); setError(null); api.usage(context.tenant.id, context.project.id, usageRangeQuery(days, lane || undefined), controller.signal).then(setReport).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) }); return () => controller.abort() }, [context, days, lane])
  const quota = context.project.policy.event_quota.effective
  const used = report?.totals.received_events ?? 0
  const quotaText = quota ? `${number(used)} / ${number(quota)} (${Math.min(100, used / quota * 100).toFixed(1)}%)` : `${number(used)}（未设置配额）`
  return <section><Header title="用量" detail="按 UTC 自然日汇总已接收的事件与流量；统计范围最长 92 天。" /><ConsoleCard className="usage-controls panel"><label>统计范围<ConsoleSelect value={days} onChange={event => setDays(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option></ConsoleSelect></label><label>采集通道<ConsoleSelect value={lane} onChange={event => setLane(event.target.value as UsageDaily['lane'] | '')}><option value="">全部通道</option><option value="analytics">分析</option><option value="error">错误</option><option value="behavior">行为</option><option value="replay">回放</option><option value="performance">性能</option></ConsoleSelect></label></ConsoleCard>{error ? <Problem error={error} /> : !report ? <Loading /> : report.daily.length ? <><div className="metric-grid"><ConsoleCard className="panel metric"><span>已接收事件</span><strong>{number(report.totals.received_events)}</strong></ConsoleCard><ConsoleCard className="panel metric"><span>接收流量</span><strong>{formatBytes(report.totals.received_bytes)}</strong></ConsoleCard><ConsoleCard className="panel metric"><span>项目事件配额</span><strong className="quota-value">{quotaText}</strong></ConsoleCard></div><Table headers={['UTC 日期', '通道', '事件', '流量']} rows={report.daily.map(item => [item.usage_date, laneLabel(item.lane), number(item.received_events), formatBytes(item.received_bytes)])} /></> : <Empty title="还没有产生用量" detail="创建项目 Key 并完成 SDK 接入后，这里会按天显示每个采集通道的事件量和流量。" action={{ label: '前往 SDK 接入', href: '/sdk' }} />}</section>
}
function BillingPage({ context }: { context: AppContext }) {
  const [subscription, setSubscription] = useState<UsageSubscription | null | undefined>(undefined)
  const [error, setError] = useState<ApiError | null>(null)
  const [hardLimit, setHardLimit] = useState(false)
  const [gracePercent, setGracePercent] = useState('0')
  const [lane, setLane] = useState<UsageDaily['lane']>('analytics')
  const [deltaEvents, setDeltaEvents] = useState('0')
  const [deltaBytes, setDeltaBytes] = useState('0')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<'settings' | 'adjustment' | null>(null)
  const owner = context.tenant.role === 'owner'
  const load = async (signal?: AbortSignal) => {
    try {
      const result = await api.usageSubscription(context.tenant.id, signal)
      setSubscription(result.subscription)
      if (result.subscription) { setHardLimit(result.subscription.hard_limit_enabled); setGracePercent(String(result.subscription.grace_percent)) }
    } catch (value) { if (!(value instanceof DOMException)) setError(value as ApiError) }
  }
  useEffect(() => { const controller = new AbortController(); setSubscription(undefined); setError(null); void load(controller.signal); return () => controller.abort() }, [context.tenant.id])
  const saveSettings = async (event: FormEvent) => {
    event.preventDefault(); const grace = Number(gracePercent)
    if (!Number.isSafeInteger(grace) || grace < 0 || grace > 1000) return
    setBusy('settings'); setError(null)
    try { const result = await api.updateUsageSubscription(context.tenant.id, { hard_limit_enabled: hardLimit, grace_percent: grace }); setSubscription(result.subscription); setHardLimit(result.subscription.hard_limit_enabled); setGracePercent(String(result.subscription.grace_percent)) } catch (value) { setError(value as ApiError) } finally { setBusy(null) }
  }
  const submitAdjustment = async (event: FormEvent) => {
    event.preventDefault(); const events = Number(deltaEvents); const bytes = Number(deltaBytes); const normalizedReason = reason.trim()
    if (!confirmed || !Number.isSafeInteger(events) || !Number.isSafeInteger(bytes) || (events === 0 && bytes === 0) || !normalizedReason || normalizedReason.length > 500) return
    setBusy('adjustment'); setError(null)
    try { const result = await api.adjustUsage(context.tenant.id, { lane, delta_events: events, delta_bytes: bytes, reason: normalizedReason }); setSubscription(result.subscription); setDeltaEvents('0'); setDeltaBytes('0'); setReason(''); setConfirmed(false) } catch (value) { setError(value as ApiError) } finally { setBusy(null) }
  }
  if (error && subscription === undefined) return <section><Header title="套餐与配额" detail="管理组织用量与配额策略" /><Problem error={error} /></section>
  if (subscription === undefined) return <section><Header title="套餐与配额" detail="租户级内部套餐与当前计量周期。" /><Loading /></section>
  if (!subscription) return <section><Header title="套餐与配额" detail="租户级内部套餐与当前计量周期。" />{error ? <Problem error={error} /> : <Empty title="当前没有有效套餐周期" detail="尚未配置内部套餐，采集不会因此被页面自动限制。" />}</section>
  const counters = new Map(subscription.counters.map(counter => [counter.lane, counter]))
  const allowance = (laneName: UsageDaily['lane']) => laneName === 'analytics' ? subscription.plan.included_events : laneName === 'error' ? subscription.plan.included_errors : laneName === 'behavior' ? subscription.plan.included_behavior_events : laneName === 'replay' ? subscription.plan.included_replay_bytes : null
  const usageValue = (laneName: UsageDaily['lane']) => { const counter = counters.get(laneName); return laneName === 'replay' ? (counter?.accepted_bytes ?? 0) + (counter?.adjustment_bytes ?? 0) : (counter?.accepted_events ?? 0) + (counter?.adjustment_events ?? 0) }
  const rows: UsageDaily['lane'][] = ['analytics', 'error', 'behavior', 'replay', 'performance']
  const usageTable = <Table headers={['通道', '已计量', '手工调整', '包含额度', '状态']} rows={rows.map(item => {
    const counter = counters.get(item); const isReplay = item === 'replay'; const actual = usageValue(item); const limit = allowance(item); const adjusted = isReplay ? counter?.adjustment_bytes ?? 0 : counter?.adjustment_events ?? 0
    return [laneLabel(item), isReplay ? formatBytes(actual) : number(actual), isReplay ? formatBytes(adjusted) : number(adjusted), limit === null ? '不设商业额度' : isReplay ? formatBytes(limit) : number(limit), limit === null ? '仅记录' : actual > Math.floor(limit * (100 + subscription.grace_percent) / 100) ? '超过宽限' : '正常']
  })} />
  return <section><Header title="套餐与配额" detail="这是内部套餐与用量控制，不包含价格、付款方式、扣款或支付处理。" />{error && <Problem error={error} />}
    <Tabs defaultValue="overview"><TabsList variant="line"><TabsTrigger value="overview">用量概览</TabsTrigger><TabsTrigger value="policy">配额策略</TabsTrigger>{owner && <TabsTrigger value="adjustment">手工调整</TabsTrigger>}</TabsList>
      <TabsContent value="overview"><ConsoleCard className="panel billing-summary"><div><span>当前内部套餐</span><strong>{subscription.plan.name}</strong><small>{subscription.plan.code}</small></div><div><span>周期开始</span><strong>{formatTime(subscription.cycle_started_at)}</strong></div><div><span>下次重置</span><strong>{formatTime(subscription.cycle_ends_at)}</strong></div></ConsoleCard>{usageTable}</TabsContent>
      <TabsContent value="policy">{owner ? <form className="panel billing-form" onSubmit={saveSettings}><h2>配额执行</h2><p className="help">默认只计量和告警。开启 hard limit 后，超过当前套餐额度加宽限时，新的对应采集请求会收到 <code>429 quota_exceeded</code>，直到下次重置。</p><label className="policy-switch"><span><strong>启用 hard limit</strong><small>这是显式拒收开关，关闭时不会因为商业额度拒绝采集。</small></span><ConsoleInput type="checkbox" checked={hardLimit} onChange={event => setHardLimit(event.target.checked)} /></label><label>宽限比例（0–1000%）<ConsoleInput type="number" min="0" max="1000" required value={gracePercent} onChange={event => setGracePercent(event.target.value)} /></label><div className="actions"><ConsoleButton type="submit" disabled={busy !== null}>{busy === 'settings' ? '正在保存…' : '保存配额执行设置'}</ConsoleButton></div></form> : <ConsoleCard className="panel"><h2>仅租户 Owner 可配置</h2><p className="help">当前角色可查看周期和计量汇总；hard limit、宽限和手工调整仅由租户 Owner 执行。</p></ConsoleCard>}</TabsContent>
      {owner && <TabsContent value="adjustment"><form className="panel billing-form billing-adjustment" onSubmit={submitAdjustment}><div className="danger-zone-heading"><div><span>审计操作</span><h2>手工用量调整</h2></div><ConsoleBadge variant="destructive">影响额度判定</ConsoleBadge></div><p className="help">调整只写入当前周期的可审计调整账本，不会改写原始日用量。正数增加已计量用量，负数抵扣；请填写可追溯原因。</p><div className="billing-adjustment-fields"><label>通道<ConsoleSelect value={lane} onChange={event => setLane(event.target.value as UsageDaily['lane'])}>{rows.map(item => <option key={item} value={item}>{laneLabel(item)}</option>)}</ConsoleSelect></label><label>事件调整<ConsoleInput type="number" step="1" value={deltaEvents} onChange={event => setDeltaEvents(event.target.value)} /></label><label>字节调整<ConsoleInput type="number" step="1" value={deltaBytes} onChange={event => setDeltaBytes(event.target.value)} /></label></div><label>调整原因<ConsoleInput required minLength={1} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><label className="inline-toggle"><ConsoleInput type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我确认该调整会写入审计日志，并影响当前周期的额度判定。</label><div className="actions"><ConsoleButton type="submit" className="danger" disabled={busy !== null || !confirmed}>{busy === 'adjustment' ? '正在写入…' : '确认并写入调整'}</ConsoleButton></div></form></TabsContent>}
    </Tabs>
  </section>
}

function AlertsPage({ context }: { context: AppContext }) {
  const [targetType, setTargetType] = useState<AlertNotificationType>('lark_bot')
  const [targetLabel, setTargetLabel] = useState('')
  const [ruleName, setRuleName] = useState('')
  const [ruleType, setRuleType] = useState<AlertRuleType>('error_new')
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([])
  const [threshold, setThreshold] = useState('1')
  const [windowSeconds, setWindowSeconds] = useState('900')
  const [minimumSamples, setMinimumSamples] = useState('100')
  const [targets, setTargets] = useState<AlertTarget[] | null>(null)
  const [rules, setRules] = useState<AlertRule[] | null>(null)
  const [instances, setInstances] = useState<AlertInstance[] | null>(null)
  const [deliveries, setDeliveries] = useState<AlertDelivery[] | null>(null)
  const [cursors, setCursors] = useState({ targets: null as string | null, rules: null as string | null, instances: null as string | null, deliveries: null as string | null })
  const [editingTarget, setEditingTarget] = useState<AlertTarget | null>(null)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const needsCondition = ruleType !== 'error_new' && ruleType !== 'error_regression'
  const needsSamples = ruleType === 'performance_p75' || ruleType === 'performance_rating'
  const enabledTargets = (targets ?? []).filter(target => target.enabled && target.verified_at && !target.disabled_at)
  const query = (cursor?: string) => new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}) })
  const loadPage = async (kind: 'targets' | 'rules' | 'instances' | 'deliveries', cursor?: string) => {
    if (kind === 'targets') { const result = await api.alertTargets(context.tenant.id, context.project.id, query(cursor)); setTargets(current => cursor ? [...(current ?? []), ...result.items] : result.items); setCursors(current => ({ ...current, targets: result.next_cursor })); return }
    if (kind === 'rules') { const result = await api.alertRules(context.tenant.id, context.project.id, query(cursor)); setRules(current => cursor ? [...(current ?? []), ...result.items] : result.items); setCursors(current => ({ ...current, rules: result.next_cursor })); return }
    if (kind === 'instances') { const result = await api.alertInstances(context.tenant.id, context.project.id, query(cursor)); setInstances(current => cursor ? [...(current ?? []), ...result.items] : result.items); setCursors(current => ({ ...current, instances: result.next_cursor })); return }
    const result = await api.alertDeliveries(context.tenant.id, context.project.id, query(cursor)); setDeliveries(current => cursor ? [...(current ?? []), ...result.items] : result.items); setCursors(current => ({ ...current, deliveries: result.next_cursor }))
  }
  const loadMore = (kind: 'targets' | 'rules' | 'instances' | 'deliveries') => {
    const cursor = cursors[kind]; if (!cursor) return
    setBusy(`more-${kind}`); setError(null)
    void loadPage(kind, cursor).catch(value => setError(value as ApiError)).finally(() => setBusy(null))
  }
  useEffect(() => {
    const controller = new AbortController()
    setTargets(null); setRules(null); setInstances(null); setDeliveries(null); setCursors({ targets: null, rules: null, instances: null, deliveries: null }); setSelectedTargetIds([]); setEditingTarget(null); setEditingRule(null); setError(null)
    Promise.all([
      api.alertTargets(context.tenant.id, context.project.id, query(), controller.signal),
      api.alertRules(context.tenant.id, context.project.id, query(), controller.signal),
      api.alertInstances(context.tenant.id, context.project.id, query(), controller.signal),
      api.alertDeliveries(context.tenant.id, context.project.id, query(), controller.signal),
    ]).then(([targetResult, ruleResult, instanceResult, deliveryResult]) => {
      setTargets(targetResult.items); setRules(ruleResult.items); setInstances(instanceResult.items); setDeliveries(deliveryResult.items)
      setCursors({ targets: targetResult.next_cursor, rules: ruleResult.next_cursor, instances: instanceResult.next_cursor, deliveries: deliveryResult.next_cursor })
    }).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) })
    return () => controller.abort()
  }, [context.tenant.id, context.project.id])
  async function createTarget(event: FormEvent) {
    event.preventDefault(); const label = targetLabel.trim(); if (!label) return
    setBusy('target'); setError(null)
    try { await api.createAlertTarget(context.tenant.id, context.project.id, { type: targetType, label }); setTargetLabel(''); await loadPage('targets') } catch (value) { setError(value as ApiError) } finally { setBusy(null) }
  }
  async function createRule(event: FormEvent) {
    event.preventDefault(); const name = ruleName.trim(); if (!name || !selectedTargetIds.length) return
    const condition: AlertCondition = alertCondition(ruleType, threshold, windowSeconds, minimumSamples)
    if (!validAlertCondition(ruleType, condition)) return
    setBusy('rule'); setError(null)
    try { await api.createAlertRule(context.tenant.id, context.project.id, { name, rule_type: ruleType, condition, target_ids: selectedTargetIds }); setRuleName(''); setSelectedTargetIds([]); await loadPage('rules') } catch (value) { setError(value as ApiError) } finally { setBusy(null) }
  }
  const toggleTarget = (id: string) => setSelectedTargetIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  const disableTarget = async (target: AlertTarget) => { setBusy(`target-${target.id}`); setError(null); try { await api.disableAlertTarget(context.tenant.id, context.project.id, target.id, target.updated_at); await Promise.all([loadPage('targets'), loadPage('rules')]) } catch (value) { setError(value as ApiError) } finally { setBusy(null) } }
  const disableRule = async (rule: AlertRule) => { setBusy(`rule-${rule.id}`); setError(null); try { await api.disableAlertRule(context.tenant.id, context.project.id, rule.id, rule.updated_at); await loadPage('rules') } catch (value) { setError(value as ApiError) } finally { setBusy(null) } }
  return <section>
    <Header title="告警与通知" detail="项目级规则、受控通知目标及其安全投递历史。页面和接口都不返回地址、邮箱、URL、token 或密钥。" />
    {error && <Problem error={error} />}
    <ConsoleCard className="panel alert-limitation"><strong>通知传输只能由部署侧验证</strong><p>控制台创建和管理的是安全引用，无法验证实际邮箱、Webhook 或飞书机器人的可达性。只有部署侧已验证、已启用且未禁用的目标才会被投递 Worker 使用；投递历史仅说明任务状态，不能证明收件端已阅读或处理。</p></ConsoleCard>
    <form className="panel alerts-form" onSubmit={createTarget}><h2>新建通知目标</h2><div className="alert-form-fields"><label>类型<ConsoleSelect value={targetType} onChange={event => setTargetType(event.target.value as AlertNotificationType)}><option value="lark_bot">飞书机器人</option><option value="email">邮件</option><option value="webhook">Webhook</option></ConsoleSelect></label><label>显示名称<ConsoleInput required maxLength={200} value={targetLabel} onChange={event => setTargetLabel(event.target.value)} placeholder="如：生产告警" /></label><ConsoleButton type="submit" disabled={busy !== null}>{busy === 'target' ? '正在创建…' : '创建未启用目标'}</ConsoleButton></div><p className="help">表单不会收集通知地址或凭据。创建后由受控部署配置验证并启用。</p></form>
    <ConsoleCard className="panel"><h2>通知目标</h2><p className="help">显示名称可改；停用立即阻断后续投递。未验证目标不能在此启用。</p>{targets === null ? <Loading /> : targets.length ? <><Table headers={['名称', '类型', '安全状态', '更新时间', '操作']} rows={targets.map(target => [<span key="name"><strong>{target.label}</strong><small className="muted">{target.id}</small></span>, alertTargetLabel(target.type), targetStateLabel(target), formatTime(target.updated_at), <span className="key-actions" key="actions"><ConsoleButton className="secondary" disabled={busy !== null} onClick={() => setEditingTarget(target)}>编辑</ConsoleButton>{target.enabled && <ConsoleButton className="danger" disabled={busy !== null} onClick={() => void disableTarget(target)}>{busy === `target-${target.id}` ? '正在停用…' : '停用'}</ConsoleButton>}</span>])} />{cursors.targets && <MoreButton busy={busy} label="加载更多目标" onClick={() => loadMore('targets')} />}</> : <Empty title="暂无通知目标" detail="创建后会持久保存到当前项目。" />}</ConsoleCard>
    {editingTarget && <AlertTargetEditor context={context} target={editingTarget} onCancel={() => setEditingTarget(null)} onSaved={item => { setTargets(current => current?.map(value => value.id === item.id ? item : value) ?? [item]); setEditingTarget(null) }} />}
    <form className="panel alerts-form" onSubmit={createRule}><h2>新建告警规则</h2><AlertRuleFields name={ruleName} onName={setRuleName} ruleType={ruleType} targets={enabledTargets} selectedTargetIds={selectedTargetIds} onToggleTarget={toggleTarget} threshold={threshold} onThreshold={setThreshold} windowSeconds={windowSeconds} onWindowSeconds={setWindowSeconds} minimumSamples={minimumSamples} onMinimumSamples={setMinimumSamples} /><p className="help">已选择 {selectedTargetIds.length} 个已验证目标；服务端保存时会再次验证范围和状态。</p><div className="actions"><ConsoleButton type="submit" disabled={busy !== null || !selectedTargetIds.length}>{busy === 'rule' ? '正在创建…' : '创建规则'}</ConsoleButton></div></form>
    <ConsoleCard className="panel"><h2>告警规则</h2><p className="help">编辑会以当前版本写入；如其他人已改动，服务端会拒绝旧版本，刷新后再试。</p>{rules === null ? <Loading /> : rules.length ? <><Table headers={['名称', '类型', '条件', '目标', '状态', '更新时间', '操作']} rows={rules.map(rule => [rule.name, alertRuleLabel(rule.rule_type), alertConditionLabel(rule), `${rule.target_ids.length} 个`, rule.enabled ? '已启用' : '已停用', formatTime(rule.updated_at), <span className="key-actions" key="actions"><ConsoleButton className="secondary" disabled={busy !== null} onClick={() => setEditingRule(rule)}>编辑</ConsoleButton>{rule.enabled && <ConsoleButton className="danger" disabled={busy !== null} onClick={() => void disableRule(rule)}>{busy === `rule-${rule.id}` ? '正在停用…' : '停用'}</ConsoleButton>}</span>])} />{cursors.rules && <MoreButton busy={busy} label="加载更多规则" onClick={() => loadMore('rules')} />}</> : <Empty title="暂无告警规则" detail="规则创建成功后会显示在这里。" />}</ConsoleCard>
    {editingRule && <AlertRuleEditor context={context} rule={editingRule} targets={enabledTargets} onCancel={() => setEditingRule(null)} onSaved={item => { setRules(current => current?.map(value => value.id === item.id ? item : value) ?? [item]); setEditingRule(null) }} />}
    <div className="alert-history-grid"><AlertInstancesPanel items={instances} cursor={cursors.instances} busy={busy} onMore={() => loadMore('instances')} /><AlertDeliveriesPanel items={deliveries} cursor={cursors.deliveries} busy={busy} onMore={() => loadMore('deliveries')} /></div>
  </section>
}
function AlertTargetEditor({ context, target, onCancel, onSaved }: { context: AppContext; target: AlertTarget; onCancel: () => void; onSaved: (item: AlertTarget) => void }) {
  const [label, setLabel] = useState(target.label); const [enabled, setEnabled] = useState(target.enabled); const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiError | null>(null)
  const submit = async (event: FormEvent) => { event.preventDefault(); const value = label.trim(); if (!value) return; setBusy(true); setError(null); try { onSaved(await api.updateAlertTarget(context.tenant.id, context.project.id, target.id, { expected_updated_at: target.updated_at, label: value, enabled })) } catch (reason) { setError(reason as ApiError) } finally { setBusy(false) } }
  return <form className="panel alerts-form" onSubmit={submit}><h2>编辑通知目标</h2><label>显示名称<ConsoleInput required maxLength={200} value={label} onChange={event => setLabel(event.target.value)} /></label><label className="inline-toggle"><ConsoleInput type="checkbox" checked={enabled} disabled={!target.verified_at} onChange={event => setEnabled(event.target.checked)} />启用此目标{!target.verified_at && '（等待部署侧验证）'}</label><p className="help">不显示或编辑传输地址、URL、邮箱、token 和密钥。启用请求只适用于已验证目标。</p>{error && <Problem error={error} />}<div className="actions"><ConsoleButton type="submit" disabled={busy}>{busy ? '正在保存…' : '保存'}</ConsoleButton><ConsoleButton type="button" className="secondary" disabled={busy} onClick={onCancel}>取消</ConsoleButton></div></form>
}
function AlertRuleEditor({ context, rule, targets, onCancel, onSaved }: { context: AppContext; rule: AlertRule; targets: AlertTarget[]; onCancel: () => void; onSaved: (item: AlertRule) => void }) {
  const [name, setName] = useState(rule.name); const [targetIds, setTargetIds] = useState(rule.target_ids); const [threshold, setThreshold] = useState(String(rule.condition.threshold ?? 1)); const [windowSeconds, setWindowSeconds] = useState(String(rule.condition.window_seconds ?? 900)); const [minimumSamples, setMinimumSamples] = useState(String(rule.condition.minimum_samples ?? 100)); const [enabled, setEnabled] = useState(rule.enabled); const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiError | null>(null)
  const toggle = (id: string) => setTargetIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  const submit = async (event: FormEvent) => { event.preventDefault(); const normalized = name.trim(); const condition = alertCondition(rule.rule_type, threshold, windowSeconds, minimumSamples); if (!normalized || !targetIds.length || !validAlertCondition(rule.rule_type, condition)) return; setBusy(true); setError(null); try { onSaved(await api.updateAlertRule(context.tenant.id, context.project.id, rule.id, { expected_updated_at: rule.updated_at, name: normalized, condition, target_ids: targetIds, enabled })) } catch (reason) { setError(reason as ApiError) } finally { setBusy(false) } }
  return <form className="panel alerts-form" onSubmit={submit}><h2>编辑告警规则</h2><AlertRuleFields name={name} onName={setName} ruleType={rule.rule_type} targets={targets} selectedTargetIds={targetIds} onToggleTarget={toggle} threshold={threshold} onThreshold={setThreshold} windowSeconds={windowSeconds} onWindowSeconds={setWindowSeconds} minimumSamples={minimumSamples} onMinimumSamples={setMinimumSamples} /><label className="inline-toggle"><ConsoleInput type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />启用此规则</label><p className="help">当前可选目标必须已经部署侧验证。原有关联目标若已不可用，请改选有效目标后保存。</p>{error && <Problem error={error} />}<div className="actions"><ConsoleButton type="submit" disabled={busy || !targetIds.length}>{busy ? '正在保存…' : '保存规则'}</ConsoleButton><ConsoleButton type="button" className="secondary" disabled={busy} onClick={onCancel}>取消</ConsoleButton></div></form>
}
function AlertRuleFields({ name, onName, ruleType, targets, selectedTargetIds, onToggleTarget, threshold, onThreshold, windowSeconds, onWindowSeconds, minimumSamples, onMinimumSamples }: { name: string; onName: (value: string) => void; ruleType: AlertRuleType; targets: AlertTarget[]; selectedTargetIds: string[]; onToggleTarget: (id: string) => void; threshold: string; onThreshold: (value: string) => void; windowSeconds: string; onWindowSeconds: (value: string) => void; minimumSamples: string; onMinimumSamples: (value: string) => void }) {
  const needsCondition = ruleType !== 'error_new' && ruleType !== 'error_regression'; const needsSamples = ruleType === 'performance_p75' || ruleType === 'performance_rating'
  return <><div className="alert-rule-fields"><label>规则名称<ConsoleInput required maxLength={200} value={name} onChange={event => onName(event.target.value)} /></label><label>规则类型<ConsoleInput value={alertRuleLabel(ruleType)} disabled /></label>{needsCondition && <><label>阈值<ConsoleInput type="number" required min="0.000001" step="any" value={threshold} onChange={event => onThreshold(event.target.value)} /></label><label>统计窗口<ConsoleSelect value={windowSeconds} onChange={event => onWindowSeconds(event.target.value)}><option value="300">5 分钟</option><option value="900">15 分钟</option><option value="3600">1 小时</option><option value="86400">24 小时</option></ConsoleSelect></label>{needsSamples && <label>最少样本数<ConsoleInput type="number" required min="1" max="1000000" step="1" value={minimumSamples} onChange={event => onMinimumSamples(event.target.value)} /></label>}</>}</div><div className="alert-target-list">{targets.length ? targets.map(target => <label className="alert-target" key={target.id}><ConsoleInput type="checkbox" checked={selectedTargetIds.includes(target.id)} onChange={() => onToggleTarget(target.id)} /><span><strong>{target.label}</strong><small>{alertTargetLabel(target.type)} · 已验证可用</small></span><code>{target.id}</code></label>) : <p className="help">当前没有已验证且已启用的通知目标。</p>}</div></>
}
function AlertInstancesPanel({ items, cursor, busy, onMore }: { items: AlertInstance[] | null; cursor: string | null; busy: string | null; onMore: () => void }) { return <ConsoleCard className="panel"><h2>告警触发历史</h2><p className="help">仅显示规则、安全聚合摘要和时间；不显示原始事件属性或用户标识。</p>{items === null ? <Loading /> : items.length ? <><Table headers={['规则', '状态', '最近触发', '安全摘要']} rows={items.map(item => [item.rule.name, alertInstanceStatus(item.status), formatTime(item.last_triggered_at), alertSummaryLabel(item.summary)])} />{cursor && <MoreButton busy={busy} label="加载更多触发记录" onClick={onMore} />}</> : <Empty title="暂无触发记录" detail="规则满足条件后会在这里留下安全摘要。" />}</ConsoleCard> }
function AlertDeliveriesPanel({ items, cursor, busy, onMore }: { items: AlertDelivery[] | null; cursor: string | null; busy: string | null; onMore: () => void }) { return <ConsoleCard className="panel"><h2>通知投递历史</h2><p className="help">状态仅表示 Worker 的投递尝试结果；不验证外部收件端是否阅读，且不暴露传输地址或密钥。</p>{items === null ? <Loading /> : items.length ? <><Table headers={['目标', '状态', '尝试', '最近尝试', '结果']} rows={items.map(item => [item.target.label, alertDeliveryStatus(item.status), number(item.attempt_count), item.last_attempt_at ? formatTime(item.last_attempt_at) : '尚未尝试', item.delivered_at ? `已投递 ${formatTime(item.delivered_at)}` : item.error_code ? `失败代码：${item.error_code}` : '等待 Worker'])} />{cursor && <MoreButton busy={busy} label="加载更多投递记录" onClick={onMore} />}</> : <Empty title="暂无投递记录" detail="触发规则并排队后，这里会显示安全状态。" />}</ConsoleCard> }
function MoreButton({ busy, label, onClick }: { busy: string | null; label: string; onClick: () => void }) { return <div className="actions"><ConsoleButton className="secondary" disabled={busy !== null} onClick={onClick}>{busy?.startsWith('more-') ? '正在加载…' : label}</ConsoleButton></div> }
function alertTargetLabel(value: AlertNotificationType) { return ({ lark_bot: '飞书机器人', email: '邮件', webhook: 'Webhook' })[value] }
function alertRuleLabel(value: AlertRuleType) { return ({ error_new: '新错误', error_regression: '错误回归', error_count: '错误数量', performance_p75: '性能 P75', performance_rating: '性能评级' })[value] }
function targetStateLabel(target: AlertTarget) { return target.disabled_at ? '已停用' : !target.enabled ? '未启用' : !target.verified_at ? '等待部署侧验证' : '已验证可投递' }
function alertCondition(type: AlertRuleType, threshold: string, windowSeconds: string, minimumSamples: string): AlertCondition { return type === 'error_new' || type === 'error_regression' ? {} : { threshold: Number(threshold), window_seconds: Number(windowSeconds), ...(type.startsWith('performance_') ? { minimum_samples: Number(minimumSamples) } : {}) } }
function validAlertCondition(type: AlertRuleType, condition: AlertCondition) { return type === 'error_new' || type === 'error_regression' || Object.values(condition).every(value => Number.isFinite(value) && value > 0) }
function alertConditionLabel(rule: AlertRule) { if (rule.rule_type === 'error_new' || rule.rule_type === 'error_regression') return '触发即通知'; const parts = [`阈值 ${rule.condition.threshold ?? '—'}`, `窗口 ${rule.condition.window_seconds ?? '—'} 秒`]; if (rule.condition.minimum_samples !== undefined) parts.push(`最少样本 ${rule.condition.minimum_samples}`); return parts.join(' · ') }
function alertSummaryLabel(summary: AlertInstance['summary']) { const parts = Object.entries(summary).map(([key, value]) => `${alertSummaryKey(key)} ${value}`); return parts.length ? parts.join(' · ') : '无额外安全摘要' }
function alertSummaryKey(value: string) { return ({ count: '数量', window_seconds: '窗口（秒）', metric: '指标', sample_count: '样本', poor_ratio: '较差比例', release: '版本' })[value] ?? value }
function alertInstanceStatus(value: string) { return ({ active: '活跃', resolved: '已恢复', suppressed: '已抑制' })[value] ?? value }
function alertDeliveryStatus(value: string) { return ({ queued: '等待投递', delivered: '已交给传输方', failed: '投递失败', cancelled: '已取消' })[value] ?? value }

function MembersPage({ context, viewerId }: { context: AppContext; viewerId: string }) {
  const [email, setEmail] = useState(''); const [displayName, setDisplayName] = useState(''); const [role, setRole] = useState<InvitationRole>('member'); const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiError | null>(null); const [result, setResult] = useState<DirectMemberCreation | null>(null)
  const [inviteEmail, setInviteEmail] = useState(''); const [inviteRole, setInviteRole] = useState<InvitationRole>('member'); const [inviteBusy, setInviteBusy] = useState(false); const [created, setCreated] = useState<Invitation[]>([])
  const [members, setMembers] = useState<TenantMember[] | null>(null); const [projects, setProjects] = useState<Project[]>([])
  const canManageMembers = context.tenant.role === 'owner' || context.tenant.role === 'admin'
  const canManageAccess = context.tenant.role === 'owner'
  const loadMembers = async (signal?: AbortSignal) => {
    if (!canManageAccess) return
    const [memberResult, projectResult] = await Promise.all([api.members(context.tenant.id, signal), api.projects(context.tenant.id, signal)])
    setMembers(memberResult.items); setProjects(projectResult.items)
  }
  useEffect(() => { if (!canManageAccess) return; const controller = new AbortController(); setMembers(null); setError(null); void loadMembers(controller.signal).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) }); return () => controller.abort() }, [context.tenant.id, canManageAccess])
  const create = async (event: FormEvent) => { event.preventDefault(); const normalizedName = displayName.trim(); if (!normalizedName) return; setBusy(true); setError(null); setResult(null); try { setResult(await api.createDirectMember(context.tenant.id, { email, display_name: normalizedName, role })); setEmail(''); setDisplayName(''); await loadMembers() } catch (value) { setError(value as ApiError) } finally { setBusy(false) } }
  const invite = async (event: FormEvent) => { event.preventDefault(); setInviteBusy(true); setError(null); try { const response = await api.createInvitation(context.tenant.id, { email: inviteEmail, role: inviteRole }); setCreated(items => [response.invitation, ...items.filter(item => item.id !== response.invitation.id)]); setInviteEmail('') } catch (value) { setError(value as ApiError) } finally { setInviteBusy(false) } }
  const roles = <><option value="member">成员</option><option value="viewer">只读成员</option>{context.tenant.role === 'owner' && <option value="admin">管理员</option>}</>
  return <section><Header title="成员与项目权限" detail="角色决定成员能做什么；项目权限决定成员可以进入哪些项目。" />{error && <Problem error={error} />}<ConsoleCard className="panel"><h2>当前账户</h2><Table headers={['账户 ID', '租户角色']} rows={[[<code key="id">{viewerId}</code>, roleLabel(context.tenant.role)]]} /></ConsoleCard>{canManageMembers ? <Tabs defaultValue="members"><TabsList variant="line"><TabsTrigger value="members">成员与权限</TabsTrigger><TabsTrigger value="invites">邀请成员</TabsTrigger></TabsList><TabsContent value="members"><div className="settings-stack">{canManageAccess && <ConsoleCard className="panel"><h2>成员项目范围</h2><p className="help">所有者始终拥有全部项目。清空某成员的全部项目会立刻让其无法进入当前组织的项目。</p>{members === null ? <Loading /> : <div className="member-access-list">{members.map(member => <div className="member-access-row" key={member.user_id}><div className="member-access-identity"><strong>{member.display_name}</strong><span>{member.email}</span></div><span>{roleLabel(member.role)}</span>{member.all_projects ? <strong>全部项目</strong> : <MemberProjectAccessEditor tenantId={context.tenant.id} member={member} projects={projects} onSaved={projectIds => setMembers(items => items?.map(item => item.user_id === member.user_id ? { ...item, project_ids: projectIds } : item) ?? null)} onError={setError} />}</div>)}</div>}</ConsoleCard>}<form className="member-invite panel" onSubmit={create}><div><h2>直接创建账号</h2><p className="help">新账号加入租户后默认没有项目权限，由所有者明确分配。</p></div><div className="direct-member-fields"><label>邮箱<ConsoleInput type="email" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" /></label><label>显示名称<ConsoleInput required maxLength={200} value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" /></label><label>角色<ConsoleSelect value={role} onChange={event => setRole(event.target.value as InvitationRole)}>{roles}</ConsoleSelect></label><ConsoleButton type="submit" disabled={busy}>{busy ? '正在创建…' : '创建并显示密码'}</ConsoleButton></div></form>{result && <DirectMemberResult result={result} onDismiss={() => setResult(null)} />}</div></TabsContent><TabsContent value="invites"><div className="settings-stack"><form className="member-invite panel" onSubmit={invite}><div><h2>邮件邀请</h2><p className="help">邀请接受后，所有者再为新成员分配项目。</p></div><div className="member-invite-fields"><label>邮箱<ConsoleInput type="email" required maxLength={320} value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} autoComplete="email" /></label><label>角色<ConsoleSelect value={inviteRole} onChange={event => setInviteRole(event.target.value as InvitationRole)}>{roles}</ConsoleSelect></label><ConsoleButton type="submit" disabled={inviteBusy}>{inviteBusy ? '正在发送…' : '发送邀请'}</ConsoleButton></div></form><ConsoleCard className="panel"><h2>本次会话已发送的邀请</h2>{created.length ? <Table headers={['角色', '创建时间', '失效时间', '状态']} rows={created.map(item => [roleLabel(item.role), formatTime(item.created_at), formatTime(item.expires_at), invitationStatus(item)])} /> : <Empty title="本次会话尚未发送邀请" />}</ConsoleCard></div></TabsContent></Tabs> : <ConsoleCard className="panel muted">当前角色不能管理租户成员或项目权限。</ConsoleCard>}</section>
}

function MemberProjectAccessEditor({ tenantId, member, projects, onSaved, onError }: { tenantId: string; member: TenantMember; projects: Project[]; onSaved: (projectIds: string[]) => void; onError: (error: ApiError | null) => void }) {
  const [selected, setSelected] = useState(member.project_ids); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false)
  useEffect(() => setSelected(member.project_ids), [member.user_id, member.project_ids.join(':')])
  const toggle = (projectId: string, checked: boolean) => { setSaved(false); setSelected(items => checked ? [...items, projectId] : items.filter(id => id !== projectId)) }
  const save = async () => { setSaving(true); setSaved(false); onError(null); try { const result = await api.updateMemberProjects(tenantId, member.user_id, selected); onSaved(result.project_ids); setSaved(true) } catch (value) { onError(value as ApiError) } finally { setSaving(false) } }
  const saveControl = selected.length === 0 && member.project_ids.length > 0 ? <ConfirmAction label="移除全部项目权限" title={`移除 ${member.display_name} 的全部项目权限？`} impact="该成员将立即无法进入此组织下的任何项目；租户成员关系不会被删除。" confirmLabel="确认移除" disabled={saving} onConfirm={() => void save()} /> : <ConsoleButton type="button" className="secondary" disabled={saving} onClick={() => void save()}>{saving ? '正在保存…' : '保存项目权限'}</ConsoleButton>
  return <div className="project-access-editor"><div className="project-access-options">{projects.map(project => <label key={project.id}><ConsoleInput type="checkbox" checked={selected.includes(project.id)} onChange={event => toggle(project.id, event.target.checked)} /><span>{project.name}</span></label>)}</div><div className="actions">{saveControl}{saved && <span className="notice" role="status">已保存</span>}</div></div>
}

function projectNames(projectIds: string[], projects: Project[]) { return projectIds.length ? projectIds.map(id => projects.find(project => project.id === id)?.name ?? id).join('、') : '未分配项目' }

function DirectMemberResult({ result, onDismiss }: { result: DirectMemberCreation; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { if (!result.initial_password) return; try { await navigator.clipboard.writeText(`邮箱：${result.member.email}\n初始密码：${result.initial_password}`); setCopied(true) } catch { /* The credential remains visible for manual copy. */ } }
  if (result.existing_user) return <div className="notice" role="status"><strong>{result.member.email} 已加入当前租户。</strong><span>该邮箱已有知迹账号，未生成或显示密码。</span></div>
  if (!result.initial_password) return <div className="notice" role="status"><strong>账号已创建。</strong><span>服务端未返回可交付的初始密码，请联系系统管理员处理登录凭据。</span></div>
  return <div className="member-credentials" role="status"><div><strong>请现在交付登录凭据</strong><p>生成的登录密码仅在此处显示一次；关闭后无法再次查看。</p></div><dl><div><dt>邮箱</dt><dd><code>{result.member.email}</code></dd></div><div><dt>初始密码</dt><dd><code>{result.initial_password}</code></dd></div></dl><div className="actions"><ConsoleButton type="button" className="secondary" onClick={() => void copy()}>{copied ? '已复制凭据' : '复制邮箱和密码'}</ConsoleButton><ConsoleButton type="button" className="secondary" onClick={onDismiss}>我已交付</ConsoleButton></div></div>
}
function roleLabel(role: Tenant['role'] | InvitationRole) { return ({ owner: '所有者', admin: '管理员', member: '成员', viewer: '只读成员' })[role] }
function invitationStatus(item: Invitation) { return item.accepted_at ? '已接受' : item.revoked_at ? '已撤销' : new Date(item.expires_at).getTime() <= Date.now() ? '已过期' : '待接受' }
function laneLabel(lane: UsageDaily['lane']) { return ({ analytics: '分析', error: '错误', behavior: '行为', replay: '回放', performance: '性能' })[lane] }
function HeatmapsPage({ context }: { context: AppContext }) {
  const [pageKey, setPageKey] = useState(() => queryValue('page', '/')); const [submitted, setSubmitted] = useState(() => queryValue('page', '/')); const [items, setItems] = useState<HeatmapSummary[] | null>(null); const [detail, setDetail] = useState<HeatmapDetail | null>(null); const [selectedBin, setSelectedBin] = useState<HeatmapBin | null>(null); const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => { const c = new AbortController(); setItems(null); setDetail(null); api.heatmaps(context.tenant.id, context.project.id, new URLSearchParams({ page_key: submitted }), c.signal).then(result => setItems(result.items)).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) }); return () => c.abort() }, [context, submitted])
  const choose = async (item: HeatmapSummary) => { setError(null); setDetail(null); try { setDetail(await api.heatmapDetail(context.tenant.id, context.project.id, item.id, new URLSearchParams({ page_key: submitted }))) } catch (value) { setError(value as ApiError) } }
  const bins = detail?.bins ?? []; const peak = Math.max(1, ...bins.map(bin => bin.count)); const binAt = (x: number, y: number) => bins.find(item => item.x === x && item.y === y) ?? { x, y, count: 0 }
  const focusBin = (x: number, y: number) => { const bin = binAt(x, y); setSelectedBin(bin); requestAnimationFrame(() => document.getElementById(`heatmap-cell-${x}-${y}`)?.focus()) }
  return <section><Header title="热力图" detail="按日聚合的归一化点击坐标；不含页面文本、DOM 或输入内容。" /><form className="heatmap-form" onSubmit={event => { event.preventDefault(); setError(null); setSubmitted(pageKey); pushConsoleQuery({ page: pageKey }) }}><label>页面路径<ConsoleInput value={pageKey} onChange={event => setPageKey(event.target.value)} pattern="/[^?#@]*" required /></label><ConsoleButton type="submit">查询</ConsoleButton></form>{error ? <Problem error={error} /> : !items ? <Loading /> : !items.length ? <Empty title="还没有热力图数据" detail="先在项目设置中开启行为采集并配置页面范围；新的普通点击会自动汇总到这里。" action={{ label: '配置行为采集', href: '/settings?tab=capture' }} /> : <><Table headers={['页面版本', '视口', '动作', '样本', '覆盖时间', '操作']} rows={items.map(item => [item.page_version ?? '默认', `${item.viewport_width_bucket}px`, item.action, number(item.sample_count), `${formatTime(item.coverage_from)} 至 ${formatTime(item.coverage_to)}`, <ConsoleButton className="secondary" key={item.id} onClick={() => void choose(item)}>查看网格</ConsoleButton>])} />{detail && <ConsoleCard className="panel"><h2>热力网格</h2><p className="help">{detail.action} · {detail.viewport_width_bucket}px · {detail.page_version ?? '默认版本'}。颜色表示相对强度：低、中、高；点击网格，或聚焦网格后用方向键移动。</p><div className="heatmap-legend" aria-label="热度图例"><span>0</span><i /><i /><i /><span>高</span></div><div className="heatmap-grid" role="grid" aria-label={`${submitted} 热力图`}>{Array.from({ length: detail.grid_size * detail.grid_size }, (_, index) => { const x = index % detail.grid_size; const y = Math.floor(index / detail.grid_size); const bin = binAt(x, y); const tier = bin.count ? Math.max(1, Math.ceil(bin.count / peak * 4)) : 0; const selected = selectedBin?.x === x && selectedBin?.y === y; return <button id={`heatmap-cell-${x}-${y}`} type="button" role="gridcell" className={`heatmap-level-${tier}`} aria-label={`横向 ${x + 1}，纵向 ${y + 1}，${bin.count} 次`} aria-selected={selected} tabIndex={selected || (!selectedBin && index === 0) ? 0 : -1} key={index} onClick={() => setSelectedBin(bin)} onKeyDown={event => { const move = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[event.key]; if (!move) return; event.preventDefault(); focusBin(Math.max(0, Math.min(detail.grid_size - 1, x + move[0])), Math.max(0, Math.min(detail.grid_size - 1, y + move[1]))) }} /> })}</div><p className="heatmap-selected" role="status">{selectedBin ? `已选横向 ${selectedBin.x + 1}、纵向 ${selectedBin.y + 1}：${number(selectedBin.count)} 次 ${detail.action}` : '选择一个网格查看精确次数。'}</p><details><summary>查看可读数据表</summary><Table headers={['横向', '纵向', '次数']} rows={bins.map(bin => [bin.x + 1, bin.y + 1, number(bin.count)])} /></details></ConsoleCard>}</>}</section>
}
function Trend({ context, compact = false }: { context: AppContext; compact?: boolean }) {
  const [points, setPoints] = useState<TrendPoint[] | null>(null); const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => { const c = new AbortController(); const query = rangeQuery(7); query.set('event_names', [ 'page_view', ...context.project.core_event_names ].slice(0, 6).join(',')); api.trend(context.tenant.id, context.project.id, query, c.signal).then(x => setPoints(x.points)).catch(x => { if (!(x instanceof DOMException)) setError(x as ApiError) }); return () => c.abort() }, [context])
  if (error) return <Problem error={error} />; if (!points) return <Loading />; if (!points.length) return <Empty title="还没有分析数据" detail="完成 SDK 接入并上报第一条事件后，这里会显示趋势。" action={{ label: '前往 SDK 接入', href: '/sdk' }} />
  return <ConsoleCard className="panel"><TrendChart points={points} />{!compact && <Table headers={['时间', '事件', '次数', '访客']} rows={points.map(point => [formatTime(point.bucket_start), point.event_name, number(point.event_count), number(point.visitors)])} />}</ConsoleCard>
}

function ErrorsPage({ context }: { context: AppContext }) {
  const [items, setItems] = useState<ErrorGroup[] | null>(null); const [error, setError] = useState<ApiError | null>(null)
  const [query, setQuery] = useState(() => queryValue('q')); const [status, setStatus] = useState(() => errorStatusQuery())
  const visible = (items ?? []).filter(item => (status === 'all' || item.status === status) && `${item.type} ${item.display_message} ${item.release ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  useEffect(() => { const c = new AbortController(); api.errors(context.tenant.id, context.project.id, rangeQuery(), c.signal).then(x => setItems(x.items)).catch(x => { if (!(x instanceof DOMException)) setError(x as ApiError) }); return () => c.abort() }, [context])
  return <section><Header title="错误中心" detail="最近 7 天内发生的错误分组，优先处理影响用户的问题。" />{items && items.length > 0 && <><div className="metric-grid"><Metric label="错误分组" value={number(items.length)} /><Metric label="未解决" value={number(items.filter(item => item.status === 'unresolved').length)} /><Metric label="已解决" value={number(items.filter(item => item.status === 'resolved').length)} /></div><ConsoleCard className="panel funnel-controls"><label>搜索当前错误<ConsoleInput value={query} onChange={event => { setQuery(event.target.value); replaceConsoleQuery({ q: event.target.value.trim() || undefined, status: status === 'all' ? undefined : status }) }} placeholder="错误信息、类型或版本" /></label><label>处理状态<ConsoleSelect value={status} onChange={event => { const value = event.target.value as 'all' | ErrorGroup['status']; setStatus(value); replaceConsoleQuery({ q: query.trim() || undefined, status: value === 'all' ? undefined : value }) }}><option value="all">全部状态</option><option value="unresolved">未解决</option><option value="resolved">已解决</option><option value="ignored">已忽略</option></ConsoleSelect></label><span className="help">显示 {visible.length} / {items.length} 个分组；筛选保存在当前地址。</span></ConsoleCard></>}{error ? <Problem error={error} /> : !items ? <Loading /> : !items.length ? <Empty title="还没有错误数据" detail="接入浏览器 SDK 后，未捕获异常和手动上报的错误会在这里自动归组。" action={{ label: '前往 SDK 接入', href: '/sdk' }} /> : !visible.length ? <Empty title="没有匹配的错误" detail="试试其他关键词，或切换到全部状态。" /> : <Table headers={['状态', '错误', '版本', '次数', '最后发生']} rows={visible.map(item => [<Status key="s" status={item.status} />, <a key="m" href={consolePath(`/errors/${item.id}`)} onClick={e => { e.preventDefault(); navigate(`/errors/${item.id}`) }}>{item.type}: {item.display_message}</a>, item.release ?? '—', number(item.occurrence_count), formatTime(item.last_seen)])} />}</section>
}
function ErrorDetailPage({ context, groupId }: { context: AppContext; groupId: string }) {
  const [detail, setDetail] = useState<ErrorDetail | null>(null); const [error, setError] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false)
  useEffect(() => { const c = new AbortController(); api.error(context.tenant.id, context.project.id, groupId, c.signal).then(setDetail).catch(x => { if (!(x instanceof DOMException)) setError(x as ApiError) }); return () => c.abort() }, [context, groupId])
  if (error) return <section><Header title="错误详情" /><Problem error={error} /></section>; if (!detail) return <Loading />
  const update = async (status: ErrorGroup['status']) => { setBusy(true); try { await api.setErrorStatus(context.tenant.id, context.project.id, detail.group, status); setDetail({ ...detail, group: { ...detail.group, status, state_version: detail.group.state_version + 1 } }) } catch (value) { setError(value as ApiError) } finally { setBusy(false) } }
  return <section><a href="/console/errors" className="back" onClick={e => { e.preventDefault(); navigate('/errors') }}>← 返回错误列表</a><Header title={`${detail.group.type}: ${detail.group.display_message}`} detail={`受影响访客 ${number(detail.affected_visitor_count)} · 最后发生 ${formatTime(detail.group.last_seen)}`} actions={<><Status status={detail.group.status} /><ConsoleButton disabled={busy || detail.group.status === 'resolved'} onClick={() => void update('resolved')}>标为已解决</ConsoleButton><ConsoleButton className="secondary" disabled={busy || detail.group.status === 'ignored'} onClick={() => void update('ignored')}>忽略</ConsoleButton></>} /><ConsoleCard className="panel"><h2>最近发生</h2>{detail.recent_occurrences.length ? <Table headers={['时间', '路由', '版本', '访客']} rows={detail.recent_occurrences.map(item => [formatTime(item.occurred_at), item.route ?? item.url ?? '—', item.release ?? '—', item.visitor_id])} /> : <Empty title="没有可显示的发生记录" />}</ConsoleCard></section>
}

function AuditLogsPage({ context }: { context: AppContext }) {
  const [days, setDays] = useState<30 | 90>(30)
  const [action, setAction] = useState('')
  const [targetType, setTargetType] = useState('')
  const [items, setItems] = useState<AuditLogEntry[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async (cursor?: string, append = false) => {
    const safeAction = auditFilter(action)
    const safeTargetType = auditFilter(targetType)
    if ((action.trim() && !safeAction) || (targetType.trim() && !safeTargetType)) {
      setError('筛选条件只能包含字母、数字、下划线、点、冒号或连字符，且不超过 100 个字符。')
      return
    }
    setBusy(true); setError(null)
    const to = new Date(); const from = new Date(to.getTime() - days * 86_400_000)
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), limit: '50' })
    if (safeAction) query.set('action', safeAction)
    if (safeTargetType) query.set('target_type', safeTargetType)
    if (cursor) query.set('cursor', cursor)
    try {
      const result = await api.auditLogs(context.tenant.id, query)
      setItems(previous => append ? [ ...(previous ?? []), ...result.items ] : result.items)
      setNextCursor(result.next_cursor)
    } catch (value) {
      setError(value instanceof ApiError ? value.message : '无法加载审计日志，请稍后重试。')
    } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [context.tenant.id])
  const submit = (event: FormEvent) => { event.preventDefault(); void load() }
  return <section><Header title="审计日志" detail="仅显示安全的操作摘要；不显示元数据、请求标识或页面内容。" />
    <form className="audit-controls panel" onSubmit={submit}>
      <label>时间范围<ConsoleSelect value={days} onChange={event => setDays(Number(event.target.value) as 30 | 90)}><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option></ConsoleSelect></label>
      <label>操作筛选<ConsoleInput value={action} maxLength={100} pattern="[A-Za-z0-9_.:-]*" placeholder="如 project_key_disabled" onChange={event => setAction(event.target.value)} /></label>
      <label>目标类型<ConsoleInput value={targetType} maxLength={100} pattern="[A-Za-z0-9_.:-]*" placeholder="如 project_key" onChange={event => setTargetType(event.target.value)} /></label>
      <ConsoleButton type="submit" disabled={busy}>查询</ConsoleButton>
    </form>
    {error ? <div className="problem"><strong>无法加载审计日志</strong><span>{error}</span></div> : !items ? <Loading /> : !items.length ? <Empty title="这个范围内没有审计记录" detail="调整时间范围或筛选条件后再试。" /> : <><Table headers={['时间', '操作', '目标类型', '目标', '发起人']} rows={items.map(item => [formatTime(item.created_at), item.action, item.target_type, item.target_id, item.actor_user_id ?? '系统'])} />{nextCursor && <div><ConsoleButton className="secondary" disabled={busy} onClick={() => void load(nextCursor, true)}>加载更多</ConsoleButton></div>}</>}
  </section>
}

function auditFilter(value: string): string | undefined {
  const trimmed = value.trim()
  return /^[A-Za-z0-9_.:-]{1,100}$/.test(trimmed) ? trimmed : undefined
}

function ReplaysPage({ context }: { context: AppContext }) {
  const [items, setItems] = useState<ReplaySession[] | null>(null); const [error, setError] = useState<ApiError | null>(null); const [route, setRoute] = useState(() => queryValue('route')); const [release, setRelease] = useState(() => queryValue('release')); const [visitorId, setVisitorId] = useState(() => queryValue('visitor_id')); const [nextCursor, setNextCursor] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const load = async (cursor?: string, append = false, signal?: AbortSignal) => { const query = rangeQuery(7); query.set('limit', '50'); if (route.trim()) query.set('route', route.trim()); if (release.trim()) query.set('release', release.trim()); if (visitorId.trim()) query.set('visitor_id', visitorId.trim()); if (cursor) query.set('cursor', cursor); const result = await api.replays(context.tenant.id, context.project.id, query, signal); setItems(current => append ? [...(current ?? []), ...result.items] : result.items); setNextCursor(result.next_cursor) }
  useEffect(() => { const controller = new AbortController(); setItems(null); setError(null); void load(undefined, false, controller.signal).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) }); return () => controller.abort() }, [context.tenant.id, context.project.id])
  const submit = (event: FormEvent) => { event.preventDefault(); pushConsoleQuery({ route: route.trim() || undefined, release: release.trim() || undefined, visitor_id: visitorId.trim() || undefined }) }
  if (error) return <section><Header title="会话回放" /><Problem error={error} /></section>
  if (!items) return <Loading />
  const filtered = Boolean(route.trim() || release.trim() || visitorId.trim())
  return <section><Header title="会话回放" detail="结构快照不含文本、表单值、URL、样式或网络内容。" /><form className="panel funnel-controls" onSubmit={submit}><label>路由<ConsoleInput value={route} pattern="/[^?#@]*" onChange={event => setRoute(event.target.value)} placeholder="/checkout" /></label><label>版本<ConsoleInput value={release} onChange={event => setRelease(event.target.value)} /></label><label>访客 ID<ConsoleInput value={visitorId} onChange={event => setVisitorId(event.target.value)} /></label><ConsoleButton type="submit" disabled={busy}>筛选</ConsoleButton>{filtered && <a href={consolePath('/replays')} onClick={event => { event.preventDefault(); pushConsoleQuery({ route: undefined, release: undefined, visitor_id: undefined }) }}>清除筛选</a>}</form>{!items.length ? <Empty title={filtered ? '没有匹配的会话' : '还没有会话回放'} detail={filtered ? '调整或清除筛选条件后再试。' : '先在项目设置中开启回放并配置允许页面，新的安全时间线会出现在这里。'} action={filtered ? undefined : { label: '配置会话回放', href: '/settings' }} /> : <><Table headers={['开始时间', '路由', '版本', '分块', '操作']} rows={items.map(item => [formatTime(item.started_at), item.initial_route, item.release ?? '—', number(item.chunk_count), <a key="open" href={consolePath(`/replays/${item.id}`)} onClick={event => { event.preventDefault(); navigate(`/replays/${item.id}`) }}>查看时间线</a>])} />{nextCursor && <div className="actions"><ConsoleButton className="secondary" disabled={busy} onClick={() => { setBusy(true); void load(nextCursor, true).catch(value => setError(value as ApiError)).finally(() => setBusy(false)) }}>加载更多</ConsoleButton></div>}</>}</section>
}
function ReplayDetailPage({ context, sessionId }: { context: AppContext; sessionId: string }) {
  const [chunks, setChunks] = useState<ReplayChunk[] | null>(null); const [error, setError] = useState<ApiError | null>(null); const [eventIndex, setEventIndex] = useState(0); const [playing, setPlaying] = useState(false)
  useEffect(() => { const controller = new AbortController(); api.replayChunks(context.tenant.id, context.project.id, sessionId, controller.signal).then(result => setChunks(result.items)).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) }); return () => controller.abort() }, [context, sessionId])
  const events = chunks?.flatMap(chunk => chunk.timeline.events) ?? []
  const snapshots = events.flatMap((event, index) => event.t === 'snapshot' ? (() => { const tree = replayTree(event.tree); return tree ? [{ index, at: typeof event.at === 'number' ? event.at : 0, tree }] : [] })() : [])
  const currentIndex = Math.min(eventIndex, Math.max(0, events.length - 1)); const current = [...snapshots].reverse().find(snapshot => snapshot.index <= currentIndex)
  const state = replayFrameState(events, currentIndex)
  useEffect(() => { setEventIndex(0); setPlaying(false) }, [sessionId])
  useEffect(() => { if (!playing || events.length < 2) return; const timer = window.setInterval(() => setEventIndex(value => value >= events.length - 1 ? (setPlaying(false), value) : value + 1), 700); return () => window.clearInterval(timer) }, [playing, events.length])
  if (error) return <section><Header title="会话回放" /><Problem error={error} /></section>
  if (!chunks) return <Loading />
  return <section><a href={consolePath('/replays')} className="back" onClick={event => { event.preventDefault(); navigate('/replays') }}>← 返回会话回放</a><Header title="安全时间线" detail={`${number(events.length)} 个事件；结构快照不含文本或用户输入。`} />
    <ConsoleCard className="panel replay-player"><h2>安全播放器</h2><p className="help">播放器按采集顺序重放路由、视口、滚动与可信交互；结构只会使用最近一份经过白名单验证的快照。不会执行录制脚本、发起网络请求、导航、提交表单或显示回放文本。</p>{current ? <><div className="replay-controls"><ConsoleButton type="button" onClick={() => setPlaying(value => !value)}>{playing ? '暂停' : '播放'}</ConsoleButton><ConsoleButton type="button" onClick={() => { setPlaying(false); setEventIndex(0) }}>回到开始</ConsoleButton><label>时间点<ConsoleInput aria-label="回放时间点" type="range" min="0" max={Math.max(0, events.length - 1)} value={currentIndex} onChange={event => { setPlaying(false); setEventIndex(Number(event.target.value)) }} /></label><span>{currentIndex + 1} / {events.length}</span></div><div className="replay-state"><span>路由：{state.route ?? '未记录'}</span><span>视口：{state.viewport ? `${state.viewport.width} × ${state.viewport.height}` : '未记录'}</span><span>滚动：{state.scroll.x}, {state.scroll.y}</span></div><ReplayPlayer tree={current.tree} state={state} /></> : <Empty title="没有可回放的结构快照" detail="断裂或只含时间线事件的片段不会由播放器猜测补全。" />}</ConsoleCard>
    <VirtualTimeline events={events} currentIndex={currentIndex} onSelect={index => { setPlaying(false); setEventIndex(index) }} /></section>
}
function VirtualTimeline({ events, currentIndex, onSelect }: { events: Record<string, unknown>[]; currentIndex: number; onSelect: (index: number) => void }) {
  const pageSize = 80; const [windowStart, setWindowStart] = useState(0); const maximumStart = Math.max(0, events.length - pageSize)
  const moveWindow = (start: number) => setWindowStart(Math.max(0, Math.min(maximumStart, start)))
  useEffect(() => { setWindowStart(start => currentIndex < start || currentIndex >= start + pageSize ? Math.max(0, Math.min(maximumStart, currentIndex - Math.floor(pageSize / 2))) : start) }, [currentIndex, maximumStart])
  const visible = events.slice(windowStart, windowStart + pageSize)
  return <ConsoleCard className="panel timeline"><div className="replay-controls"><h2>时间线</h2>{events.length > pageSize && <><span className="help">显示 {windowStart + 1}–{windowStart + visible.length} / {events.length}</span><ConsoleButton className="secondary" disabled={windowStart === 0} onClick={() => moveWindow(windowStart - pageSize)}>上一段</ConsoleButton><ConsoleButton className="secondary" onClick={() => moveWindow(currentIndex - Math.floor(pageSize / 2))}>跳到当前事件</ConsoleButton><ConsoleButton className="secondary" disabled={windowStart >= maximumStart} onClick={() => moveWindow(windowStart + pageSize)}>下一段</ConsoleButton></>}</div>{events.length > pageSize && <p className="help">长时间线按窗口渲染，每段最多 {pageSize} 条；切换分段不会丢失已加载事件。</p>}{visible.length ? visible.map((event, offset) => { const index = windowStart + offset; return <ConsoleButton type="button" className={index === currentIndex ? 'timeline-event active' : 'timeline-event'} key={index} onClick={() => onSelect(index)}><strong>{String(event.t ?? 'event')}</strong><span>{formatReplayEvent(event)}</span></ConsoleButton> }) : <Empty title="没有可显示的时间线事件" />}</ConsoleCard>
}
function ReplayPlayer({ tree, state }: { tree: ReplayTreeNode; state: ReturnType<typeof replayFrameState> }) {
  const frame = useRef<HTMLIFrameElement>(null); const [nonce] = useState(() => replayNonce())
  const send = () => frame.current?.contentWindow?.postMessage({ source: 'zhiji-replay-player', tree, state }, '*')
  useEffect(() => { send() }, [tree, state])
  return <iframe ref={frame} className="replay-frame" title="安全结构回放" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={replayPlayerDocument(nonce)} onLoad={send} />
}
function replayNonce() { const bytes = new Uint8Array(18); crypto.getRandomValues(bytes); return btoa(String.fromCharCode(...bytes)) }
function formatReplayEvent(event: Record<string, unknown>) { const at = typeof event.at === 'number' ? formatTime(new Date(event.at).toISOString()) : '未知时间'; if (event.t === 'snapshot') return `${at} · 已记录安全结构快照`; if (typeof event.route === 'string') return `${at} · ${event.route}`; if (typeof event.x === 'number' && typeof event.y === 'number') return `${at} · 坐标 ${event.x}, ${event.y}`; return at }

function SourceMapsPage({ context }: { context: AppContext }) {
  const [items, setItems] = useState<SourceMapArtifact[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const load = async () => { try { setError(null); setItems((await api.sourceMaps(context.tenant.id, context.project.id)).items) } catch (value) { setError(value as ApiError) } }
  useEffect(() => { setItems(null); setError(null); void load() }, [context.tenant.id, context.project.id])
  return <section><Header title="Source Map 管理" detail="仅显示发布元数据和校验摘要。原始 map、源码路径和上传 Key 不会在控制台返回或展示。" />
    <ConsoleCard className="panel"><h2>使用方式</h2><p className="help">CI 通过 Source Map 上传 Key 上传已净化的构建产物。重复内容会幂等成功；同一发布资产需要替代时，由受控 CI 将经过校验的 map 提交给替代接口。控制台不会接收、转发或保存 map 内容。</p></ConsoleCard>
    {error && <Problem error={error} />}
    {!items ? <Loading /> : !items.length ? <Empty title="尚未上传 Source Map" detail="先创建 Source Map 上传 Key，再在 CI 中使用 Vite 插件上传已净化的 hidden source map。" action={{ label: '查看 SDK 与插件接入', href: '/sdk' }} /> : <Table headers={['Release', 'Dist', '构建资产', 'Map SHA-256', '来源数量', '上传时间', '状态']} rows={items.map(item => [item.release, item.dist, <code key="path">{item.artifact_path}</code>, <code key="hash">{shortHash(item.map_sha256)}</code>, number(item.source_count), formatTime(item.created_at), item.superseded_at ? `已替代 · ${formatTime(item.superseded_at)}` : '当前版本'])} />}
  </section>
}

function shortHash(value: string) { return value.length > 18 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value }

function LifecyclePage({ context }: { context: AppContext }) {
  const [exports, setExports] = useState<SubjectLifecycleJob[] | null>(null)
  const [deletions, setDeletions] = useState<SubjectLifecycleJob[] | null>(null)
  const [projectDeletion, setProjectDeletion] = useState<ProjectDeletionRequest | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = async () => {
    try {
      setError(null)
      const [exportResult, deletionResult, projectResult] = await Promise.all([
        api.subjectExports(context.tenant.id, context.project.id),
        api.subjectDeletions(context.tenant.id, context.project.id),
        api.projectDeletion(context.tenant.id, context.project.id).catch(value => value instanceof ApiError && value.status === 404 ? null : Promise.reject(value)),
      ])
      setExports(exportResult.items); setDeletions(deletionResult.items); setProjectDeletion(projectResult?.deletion ?? null)
    } catch (value) { setError(value as ApiError) }
  }
  useEffect(() => { setExports(null); setDeletions(null); setProjectDeletion(null); void load() }, [context.tenant.id, context.project.id])
  const create = async (kind: 'export' | 'deletion', input: { subject_business_user_id: string; purpose: string; password: string }) => {
    setBusy(kind); setError(null)
    try {
      const operation = kind === 'export' ? 'subject_export' : 'subject_deletion'
      const { proof } = await api.issueLifecycleProof(context.tenant.id, context.project.id, { operation, subject_business_user_id: input.subject_business_user_id, purpose: input.purpose, password: input.password })
      const request = { subject_business_user_id: input.subject_business_user_id, purpose: input.purpose, proof }
      if (kind === 'export') await api.requestSubjectExport(context.tenant.id, context.project.id, request)
      else await api.requestSubjectDeletion(context.tenant.id, context.project.id, request)
      await load()
    } catch (value) { setError(value as ApiError) } finally { setBusy(null) }
  }
  const download = async (job: SubjectLifecycleJob) => {
    setBusy(`download:${job.id}`); setError(null)
    try {
      const blob = await api.downloadSubjectExport(context.tenant.id, context.project.id, job.id)
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'zhiji-data-subject-export.json'; link.click(); URL.revokeObjectURL(url)
      await load()
    } catch (value) { setError(value as ApiError) } finally { setBusy(null) }
  }
  const requestProject = async (input: { purpose: string; password: string }) => {
    setBusy('project-delete'); setError(null)
    try {
      const { proof } = await api.issueLifecycleProof(context.tenant.id, context.project.id, { operation: 'project_deletion', purpose: input.purpose, password: input.password })
      await api.requestProjectDeletion(context.tenant.id, context.project.id, { purpose: input.purpose, proof, confirmation: 'DELETE_PROJECT' }); await load()
    } catch (value) { setError(value as ApiError) } finally { setBusy(null) }
  }
  const cancelProject = async () => {
    setBusy('project-cancel'); setError(null)
    try { await api.cancelProjectDeletion(context.tenant.id, context.project.id); await load() } catch (value) { setError(value as ApiError) } finally { setBusy(null) }
  }
  return <section><Header title="数据生命周期" detail="主体导出和删除都需要服务端验证的当前证明；证明值不会写入浏览器存储、审计摘要或列表。" />
    {error && <Problem error={error} />}
    <ConsoleCard className="panel"><h2>数据主体导出</h2><p className="help">导出仅包含直接归属于该业务用户的身份和遥测事实。文件写入私有存储，在请求到期前可通过一次性、15 分钟令牌下载；下载令牌不会保存在页面、地址栏或浏览器存储中。</p><SubjectLifecycleForm action="导出数据" busy={busy === 'export'} onSubmit={input => create('export', input)} /></ConsoleCard>
    <LifecycleJobs title="主体导出记录" jobs={exports} busy={busy} onDownload={download} empty="尚无主体导出申请。" />
    <ConsoleCard className="panel"><h2>数据主体删除</h2><p className="help">删除会保留访客事实，但移除该业务用户的身份、特征和关联快照；原始事实与会话记录上的业务用户字段会清空。删除后会保留墓碑，供受控恢复流程重放。</p><SubjectLifecycleForm action="申请删除" busy={busy === 'deletion'} dangerous onSubmit={input => create('deletion', input)} /></ConsoleCard>
    <LifecycleJobs title="主体删除记录" jobs={deletions} busy={busy} empty="尚无主体删除申请。" />
    <ConsoleCard className="panel"><h2>项目删除</h2><p className="help">仅租户所有者可以申请。申请后项目立即冻结写入并禁用 Key，保留 7 天撤销窗口；到期后 Worker 删除项目数据、私有工件和未完成任务，并保留删除墓碑。</p>{context.tenant.role === 'owner' ? <ProjectDeletionForm deletion={projectDeletion} busy={busy} onSubmit={requestProject} onCancel={cancelProject} /> : <p className="muted">当前角色没有申请或撤销项目删除的权限。</p>}</ConsoleCard>
  </section>
}

function SubjectLifecycleForm({ action, busy, dangerous = false, onSubmit }: { action: string; busy: boolean; dangerous?: boolean; onSubmit: (input: { subject_business_user_id: string; purpose: string; password: string }) => Promise<void> }) {
  const [subject, setSubject] = useState(''); const [purpose, setPurpose] = useState(''); const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState('')
  const normalizedSubject = subject.trim(); const confirmed = !dangerous || confirmation.trim() === normalizedSubject
  const submit = async (event: FormEvent) => { event.preventDefault(); const input = { subject_business_user_id: normalizedSubject, purpose: purpose.trim(), password }; if (!input.subject_business_user_id || !input.purpose || !input.password || !confirmed) return; await onSubmit(input); setPassword(''); if (dangerous) setConfirmation('') }
  return <form className="funnel-form" onSubmit={event => void submit(event)}><div className="funnel-controls"><label>业务用户 ID<ConsoleInput required maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} autoComplete="off" /></label><label>处理目的<ConsoleInput required maxLength={500} value={purpose} onChange={event => setPurpose(event.target.value)} /></label><label>当前账户密码<ConsoleInput type="password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" /></label>{dangerous && <label>再次输入业务用户 ID<ConsoleInput required maxLength={200} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" aria-describedby="subject-delete-confirmation-help" /></label>}</div><p id={dangerous ? 'subject-delete-confirmation-help' : undefined} className="help">{dangerous ? '删除会清除该业务用户的身份、特征、关联快照及事实上的业务用户字段。请再次输入完全相同的业务用户 ID，再完成当前密码校验。' : '提交时会先完成一次当前密码校验，签发的短时证明仅能用于本次操作，不会写入浏览器存储或审计记录。'}</p><ConsoleButton type="submit" className={dangerous ? 'danger' : ''} disabled={busy || !confirmed}>{busy ? '正在验证并提交…' : action}</ConsoleButton></form>
}

function LifecycleJobs({ title, jobs, busy, onDownload, empty }: { title: string; jobs: SubjectLifecycleJob[] | null; busy: string | null; onDownload?: (job: SubjectLifecycleJob) => Promise<void>; empty: string }) {
  if (!jobs) return <ConsoleCard className="panel"><h2>{title}</h2><Loading /></ConsoleCard>
  return <ConsoleCard className="panel"><h2>{title}</h2>{!jobs.length ? <Empty title={empty} /> : <Table headers={['申请时间', '业务用户', '状态', '到期时间', '文件', '操作']} rows={jobs.map(job => [formatTime(job.created_at), <code key="subject">{job.subject_business_user_id}</code>, lifecycleStatus(job.status), formatTime(job.expires_at), job.byte_count === null ? '—' : `${number(job.byte_count)} bytes`, job.kind === 'subject_export' && job.status === 'completed' ? <ConsoleButton key="download" className="secondary" disabled={busy !== null} onClick={() => void onDownload?.(job)}>{busy === `download:${job.id}` ? '正在下载…' : '下载一次'}</ConsoleButton> : job.reason_code ? <span key="reason" className="muted">{job.reason_code}</span> : '—'])} />}</ConsoleCard>
}

function ProjectDeletionForm({ deletion, busy, onSubmit, onCancel }: { deletion: ProjectDeletionRequest | null; busy: string | null; onSubmit: (input: { purpose: string; password: string }) => Promise<void>; onCancel: () => Promise<void> }) {
  const [purpose, setPurpose] = useState(''); const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState('')
  if (deletion) return <div><p>状态：<strong>{lifecycleStatus(deletion.status)}</strong> · 项目：<strong>{deletion.project_status ?? '—'}</strong> · 生效时间：{formatTime(deletion.effective_at)}</p>{deletion.status === 'pending' ? <ConsoleButton className="secondary" disabled={busy !== null} onClick={() => void onCancel()}>{busy === 'project-cancel' ? '正在撤销…' : '撤销项目删除'}</ConsoleButton> : <p className="help">该删除请求已无法撤销。</p>}</div>
  const submit = async (event: FormEvent) => { event.preventDefault(); if (confirmation !== 'DELETE_PROJECT' || !purpose.trim() || !password) return; await onSubmit({ purpose: purpose.trim(), password }); setPassword('') }
  return <form className="funnel-form" onSubmit={event => void submit(event)}><div className="funnel-controls"><label>处理目的<ConsoleInput required maxLength={500} value={purpose} onChange={event => setPurpose(event.target.value)} /></label><label>当前账户密码<ConsoleInput type="password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" /></label><label>输入 DELETE_PROJECT 确认<ConsoleInput required value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label></div><p className="help">此操作会先校验当前密码，随后立即冻结项目，并在 7 天撤销窗口结束后永久删除。</p><ConsoleButton type="submit" className="danger" disabled={busy !== null || confirmation !== 'DELETE_PROJECT'}>{busy === 'project-delete' ? '正在验证并申请…' : '申请项目删除'}</ConsoleButton></form>
}

function lifecycleStatus(value: string) { return ({ queued: '已排队', running: '处理中', completed: '已完成', failed: '失败', expired: '已过期', cancelled: '已取消', pending: '待生效' } as Record<string, string>)[value] ?? value }
function lifecycleFieldLabel(value: string) { return ({ raw_event_days: '原始事件', error_occurrence_days: '错误发生记录', behavior_raw_days: '行为原始记录', replay_raw_days: '回放原始记录', performance_raw_days: '性能原始记录', aggregate_days: '聚合数据', backup_expiry_days: '删除备份保护期' } as Record<string, string>)[value] ?? value }

function TenantSettingsPage({ context }: { context: AppContext }) {
  const canManage = context.tenant.role === 'owner' || context.tenant.role === 'admin'
  const [defaults, setDefaults] = useState<TenantDefaultsResponse | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (!canManage) return
    const controller = new AbortController(); setDefaults(null); setError(null); setSaved(false)
    api.tenantDefaults(context.tenant.id, controller.signal).then(result => setDefaults(result.tenant)).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) })
    return () => controller.abort()
  }, [context.tenant.id, canManage])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!defaults) return
    setBusy(true); setError(null); setSaved(false)
    try { const result = await api.updateTenantDefaults(context.tenant.id, { retention_days: defaults.retention_days, event_quota: defaults.event_quota, data_lifecycle_policy: defaults.data_lifecycle_policy }); setDefaults(result.tenant); setSaved(true) }
    catch (value) { setError(value as ApiError) } finally { setBusy(false) }
  }
  if (!canManage) return <section><Header title="租户默认策略" detail="为未单独配置的项目提供保留期和配额默认值。" /><ConsoleCard className="panel muted">当前角色没有修改租户默认策略的权限。</ConsoleCard></section>
  return <section><Header title="租户默认策略" detail="项目选择“继承租户默认策略”时使用这些保留期。套餐保留期上限由服务端校验。" />
    {error && <Problem error={error} />}
    {!defaults ? <Loading /> : <form className="settings-form" onSubmit={submit}><ConsoleCard className="panel form-grid"><label>默认保留期（天）<ConsoleInput type="number" min="1" max="10000000" required value={defaults.retention_days} onChange={event => setDefaults(current => current && { ...current, retention_days: Number(event.target.value) })} /></label><label>默认事件配额<ConsoleInput type="number" min="1" max="10000000" required value={defaults.event_quota} onChange={event => setDefaults(current => current && { ...current, event_quota: Number(event.target.value) })} /></label><p className="help">默认保留期用于旧版项目兼容字段；新项目请以下方分项生命周期策略为准。</p></ConsoleCard><ConsoleCard className="panel form-grid"><h2>分项数据生命周期</h2><p className="help">每项为正整数天数。保存时会校验当前套餐的最长保留期。</p><div className="lifecycle-grid">{Object.entries(defaults.data_lifecycle_policy).map(([key, days]) => <label key={key}>{lifecycleFieldLabel(key)}<ConsoleInput type="number" min="1" max="10000000" required value={days} onChange={event => setDefaults(current => current && { ...current, data_lifecycle_policy: { ...current.data_lifecycle_policy, [key]: Number(event.target.value) } })} /></label>)}</div></ConsoleCard><div className="actions"><ConsoleButton type="submit" disabled={busy}>{busy ? '正在保存…' : '保存租户默认策略'}</ConsoleButton>{saved && <span className="notice" role="status">已保存，继承该策略的项目将在下一次配置拉取时使用更新后的值。</span>}</div></form>}
  </section>
}

function ProjectSettingsPage({ context, onUpdated }: { context: AppContext; onUpdated: (project: Project) => void }) {
  const [settingsTab, setSettingsTab] = useState<string>(() => { const tab = new URLSearchParams(location.search).get('tab'); return tab && ['basic', 'capture', 'retention', 'keys', 'sso'].includes(tab) ? tab : 'basic' })
  const [name, setName] = useState(context.project.name)
  const [origins, setOrigins] = useState(context.project.allowed_origins.join('\n'))
  const [pageKeys, setPageKeys] = useState(context.project.page_capture.allowed_page_keys.join('\n'))
  const [routes, setRoutes] = useState(context.project.page_capture.route_templates.join('\n'))
  const [behavior, setBehavior] = useState(context.project.behavior_capture)
  const [replay, setReplay] = useState(context.project.session_replay)
  const [performance, setPerformance] = useState(context.project.performance_capture)
  const [lifecycle, setLifecycle] = useState<DataLifecyclePolicy>(context.project.policy.data_lifecycle_policy.configured ?? context.project.policy.data_lifecycle_policy.effective)
  const [inheritLifecycle, setInheritLifecycle] = useState(context.project.policy.data_lifecycle_policy.configured === null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiError | null>(null); const [saved, setSaved] = useState(false)
  useEffect(() => { const project = context.project; setName(project.name); setOrigins(project.allowed_origins.join('\n')); setPageKeys(project.page_capture.allowed_page_keys.join('\n')); setRoutes(project.page_capture.route_templates.join('\n')); setBehavior(project.behavior_capture); setReplay(project.session_replay); setPerformance(project.performance_capture); setLifecycle(project.policy.data_lifecycle_policy.configured ?? project.policy.data_lifecycle_policy.effective); setInheritLifecycle(project.policy.data_lifecycle_policy.configured === null) }, [context.project])
  useEffect(() => setSaved(false), [context.project.id])
  const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean)
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(null); setSaved(false); try {
    const behaviorChanged = JSON.stringify(behavior) !== JSON.stringify(context.project.behavior_capture)
    const behaviorCapture = behaviorChanged ? { ...behavior, policy_version: context.project.behavior_capture.policy_version + 1 } : behavior
    const result = await api.updateProject(context.tenant.id, context.project.id, { name, allowed_origins: lines(origins), page_capture: { allowed_page_keys: lines(pageKeys), route_templates: lines(routes) }, policy: { data_lifecycle_policy: inheritLifecycle ? null : lifecycle }, behavior_capture: behaviorCapture, session_replay: replay, performance_capture: performance })
    onUpdated(result.project); setSaved(true)
  } catch (value) { setError(value as ApiError) } finally { setBusy(false) } }
  return <section><Header title="项目设置" detail="Origin 和采集策略将在下一次 SDK 配置拉取时生效。" />
    <Tabs value={settingsTab} onValueChange={value => setSettingsTab(String(value))}><TabsList variant="line" aria-label="项目设置分类"><TabsTrigger value="basic">基础信息</TabsTrigger><TabsTrigger value="capture">采集配置</TabsTrigger><TabsTrigger value="retention">数据保留</TabsTrigger><TabsTrigger value="keys">访问 Key</TabsTrigger><TabsTrigger value="sso">单点登录</TabsTrigger></TabsList><form className="settings-form" hidden={settingsTab === 'keys' || settingsTab === 'sso'} onSubmit={submit} onChange={() => setSaved(false)}><TabsContent value="basic"><ConsoleCard className="panel form-grid"><label>项目名称<ConsoleInput required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label><label>允许的 Origin<ConsoleTextarea value={origins} onChange={event => setOrigins(event.target.value)} placeholder={'https://app.example.com\nhttps://admin.example.com'} /></label><p className="help">每行一个精确 HTTP(S) Origin，不能使用通配符、路径、query 或 hash。</p></ConsoleCard>
      </TabsContent><TabsContent value="capture" className="settings-stack"><ConsoleCard className="panel form-grid"><h2>页面边界</h2><label>允许采集的页面路径<ConsoleTextarea value={pageKeys} onChange={event => setPageKeys(event.target.value)} placeholder={'/\n/checkout'} /></label><label>动态路由模板<ConsoleTextarea value={routes} onChange={event => setRoutes(event.target.value)} placeholder="/orders/:orderId" /></label><p className="help">页面路径和路由模板每行一项；未知页面不会被 SDK 采集。</p></ConsoleCard>
      <ConsoleCard className="panel form-grid"><h2>行为采集与热力图</h2><PolicySwitch title="启用行为采集" value={behavior} onChange={setBehavior} incrementVersion={false} /><label>允许采集的页面路径<ConsoleTextarea required={behavior.enabled} value={behavior.page_allowlist.join('\n')} onChange={event => setBehavior(current => ({ ...current, page_allowlist: lines(event.target.value) }))} placeholder={'/\n/checkout'} /></label><label>关键元素 track-id（可选）<ConsoleTextarea value={behavior.track_ids.join('\n')} onChange={event => setBehavior(current => ({ ...current, track_ids: lines(event.target.value) }))} placeholder={'checkout-submit\nsignup-submit'} /></label><label>不采集的 CSS selector<ConsoleTextarea value={behavior.block_selectors.join('\n')} onChange={event => setBehavior(current => ({ ...current, block_selectors: lines(event.target.value) }))} placeholder={'[data-private]\n[data-sensitive]'} /></label><label>采样率<ConsoleInput type="number" min={behavior.enabled ? Number.MIN_VALUE : 0} max="1" step="any" required value={behavior.sample_rate} onChange={event => setBehavior(current => ({ ...current, sample_rate: Number(event.target.value) }))} /></label><p className="help">每项每行一项；这里的页面必须已包含在上方“页面边界”中。启用后，页面范围内的普通点击会自动汇总为热力图；不会读取 DOM、页面文本、HTML、输入值或 URL query/hash。使用 CSS selector 排除敏感区域。track-id 仅用于可选的关键元素标识；提交或变更表单仍需显式标记。</p></ConsoleCard>
      <ConsoleCard className="panel"><h2>其他采集模块</h2><p className="help">会话回放需要先完成回放存储与脱敏配置。</p><div className="policy-grid"><PolicySwitch title="会话回放" value={replay} onChange={setReplay} /><PolicySwitch title="性能采集" value={performance} onChange={setPerformance} /></div></ConsoleCard>
      </TabsContent><TabsContent value="retention"><ConsoleCard className="panel form-grid"><h2>数据保留</h2><label className="inline-toggle"><ConsoleInput type="checkbox" checked={inheritLifecycle} onChange={event => setInheritLifecycle(event.target.checked)} /><span>继承租户默认策略</span></label><p className="help">回放、行为和性能原始数据受固定上限保护；保存后以服务端返回的生效值为准。</p>{!inheritLifecycle && <div className="lifecycle-grid">{Object.entries(lifecycle).map(([key, days]) => <label key={key}>{lifecycleFieldLabel(key)}<ConsoleInput type="number" min="1" max="10000000" required value={days} onChange={event => setLifecycle(current => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div>}<Table headers={['类别', '当前生效保留期']} rows={Object.entries(context.project.policy.data_lifecycle_policy.effective).map(([key, days]) => [lifecycleFieldLabel(key), `${days} 天`])} /></ConsoleCard>
      </TabsContent>{error && <Problem error={error} />}<div className="actions"><ConsoleButton type="submit" disabled={busy}>{busy ? '正在保存…' : saved ? '已保存 ✓' : '保存项目设置'}</ConsoleButton>{saved && <span className="notice" role="status">项目设置已保存，将在下一次 SDK 配置拉取时生效。</span>}</div>
    </form><TabsContent value="keys"><ProjectKeys context={context} /></TabsContent><TabsContent value="sso"><TenantSsoSettings tenant={context.tenant} /></TabsContent></Tabs>
  </section>
}

function TenantSsoSettings({ tenant }: { tenant: Tenant }) {
  const [connections, setConnections] = useState<SsoConnection[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [issuer, setIssuer] = useState(''); const [clientId, setClientId] = useState(''); const [clientSecret, setClientSecret] = useState('')
  const [domains, setDomains] = useState(''); const [defaultRole, setDefaultRole] = useState<SsoRole>('member')
  const [linkConnectionId, setLinkConnectionId] = useState(''); const [subject, setSubject] = useState(''); const [email, setEmail] = useState(''); const [userId, setUserId] = useState('')
  const load = async () => { try { setError(null); const result = await api.ssoConnections(tenant.id); setConnections(result.connections); setLinkConnectionId(current => current && result.connections.some(item => item.id === current) ? current : result.connections[0]?.id ?? '') } catch (value) { setError(value as ApiError) } }
  useEffect(() => { setConnections(null); setError(null); setNotice(null); if (tenant.role === 'owner') void load() }, [tenant.id, tenant.role])
  if (tenant.role !== 'owner') return <div className="key-section"><Header title="单点登录（SSO）" detail="仅租户所有者可以管理 OIDC 连接。" /><ConsoleCard className="panel muted">当前角色没有管理单点登录的权限。</ConsoleCard></div>
  const lines = (value: string) => value.split('\n').map(item => item.trim().toLowerCase()).filter(Boolean)
  const create = async (event: FormEvent) => { event.preventDefault(); setBusy('create'); setError(null); setNotice(null); try { const result = await api.createSsoConnection(tenant.id, { issuer, client_id: clientId, client_secret: clientSecret, allowed_email_domains: lines(domains), default_role: defaultRole, enabled: true }); setConnections(current => current ? [...current, result.connection] : [result.connection]); setLinkConnectionId(result.connection.id); setCreating(false); setIssuer(''); setClientId(''); setClientSecret(''); setDomains(''); setDefaultRole('member'); setNotice('OIDC 连接已创建。客户端密钥不会再显示或保存在浏览器中。') } catch (value) { setError(value as ApiError) } finally { setBusy(null) } }
  const setEnabled = async (connection: SsoConnection, enabled: boolean) => { setBusy(connection.id); setError(null); setNotice(null); try { const result = await api.updateSsoConnection(tenant.id, connection.id, { enabled }); setConnections(current => current?.map(item => item.id === connection.id ? result.connection : item) ?? [result.connection]); setNotice(enabled ? 'OIDC 连接已启用。' : 'OIDC 连接已停用，新的单点登录不会再从该连接发起。') } catch (value) { setError(value as ApiError) } finally { setBusy(null) } }
  const link = async (event: FormEvent) => { event.preventDefault(); if (!linkConnectionId) return; setBusy('link'); setError(null); setNotice(null); try { await api.linkSsoIdentity(tenant.id, linkConnectionId, { subject, email, user_id: userId }); setSubject(''); setEmail(''); setUserId(''); setNotice('身份已显式关联。该用户现在可以通过已验证的 OIDC 身份登录。') } catch (value) { setError(value as ApiError) } finally { setBusy(null) } }
  return <div className="key-section sso-section"><Header title="单点登录（SSO）" detail="通过 OpenID Connect（OIDC）接入企业身份提供商。" actions={<ConsoleButton onClick={() => { setCreating(true); setNotice(null) }}>添加 OIDC 连接</ConsoleButton>} />
    <ConsoleCard className="panel"><h2>身份关联规则</h2><p className="help">首次单点登录不会按邮箱自动绑定账户。所有者必须先核验用户身份，并将 OIDC issuer、subject、已存在账户的邮箱与用户 ID 显式关联。这可避免同邮箱或外部身份被错误接管。</p></ConsoleCard>
    {notice && <p className="notice" role="status">{notice}</p>}{error && <Problem error={error} />}
    {creating && <form className="panel sso-form" onSubmit={create}><h2>新增 OIDC 连接</h2><label>Issuer URL<ConsoleInput type="url" required placeholder="https://login.example.com" value={issuer} onChange={event => setIssuer(event.target.value)} /></label><label>Client ID<ConsoleInput required maxLength={1024} value={clientId} onChange={event => setClientId(event.target.value)} autoComplete="off" /></label><label>Client secret<ConsoleInput type="password" required maxLength={4096} value={clientSecret} onChange={event => setClientSecret(event.target.value)} autoComplete="new-password" /></label><label>允许的邮箱域名（每行一个；留空允许所有域名）<ConsoleTextarea value={domains} onChange={event => setDomains(event.target.value)} placeholder={'example.com\nexample.org'} /></label><label>首次登录后的默认角色<ConsoleSelect value={defaultRole} onChange={event => setDefaultRole(event.target.value as SsoRole)}><option value="member">成员</option><option value="viewer">只读成员</option><option value="admin">管理员</option></ConsoleSelect></label><p className="help">Issuer 必须是 HTTPS 根地址。密钥只会发送给服务端加密保存，提交后本页面无法读取。</p><div className="actions"><ConsoleButton type="submit" disabled={busy === 'create'}>{busy === 'create' ? '正在创建…' : '创建并启用'}</ConsoleButton><ConsoleButton type="button" className="secondary" onClick={() => { setCreating(false); setClientSecret('') }}>取消</ConsoleButton></div></form>}
    {!connections ? <Loading /> : !connections.length ? <Empty title="尚未配置 OIDC 连接" detail="添加企业身份提供商后，再逐个显式关联可登录的已有账户。" /> : <Table headers={['Issuer', 'Client ID', '邮箱域名', '默认角色', '状态', '操作']} rows={connections.map(connection => [connection.issuer, connection.client_id, connection.allowed_email_domains.length ? connection.allowed_email_domains.join(', ') : '不限', roleLabel(connection.default_role), connection.enabled ? '启用中' : '已停用', <label className="inline-toggle" key="enabled"><ConsoleInput type="checkbox" checked={connection.enabled} disabled={busy === connection.id} onChange={event => void setEnabled(connection, event.target.checked)} /><span>{connection.enabled ? '停用' : '启用'}</span></label>])} />}
    {!!connections?.length && <form className="panel sso-form" onSubmit={link}><h2>显式关联已有账户</h2><p className="help">请从受信任的身份提供商管理界面核对 subject，并确认该用户已在当前租户中拥有同一邮箱的账户。不要让用户自行填写或通过 URL 传递 subject。</p><label>OIDC 连接<ConsoleSelect value={linkConnectionId} onChange={event => setLinkConnectionId(event.target.value)}>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.issuer}</option>)}</ConsoleSelect></label><label>OIDC subject<ConsoleInput required maxLength={1024} value={subject} onChange={event => setSubject(event.target.value)} autoComplete="off" /></label><label>已有账户邮箱<ConsoleInput type="email" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" /></label><label>已有账户用户 ID<ConsoleInput required value={userId} onChange={event => setUserId(event.target.value)} autoComplete="off" /></label><div className="actions"><ConsoleButton type="submit" disabled={busy === 'link'}>{busy === 'link' ? '正在关联…' : '核验后关联身份'}</ConsoleButton></div></form>}
  </div>
}

function PolicySwitch<T extends CapturePolicy>({ title, value, onChange, incrementVersion = true }: { title: string; value: T; onChange: (value: T) => void; incrementVersion?: boolean }) { return <label className="policy-switch"><span><strong>{title}</strong><small>策略版本 {value.policy_version}</small></span><ConsoleInput type="checkbox" checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.target.checked, policy_version: incrementVersion ? value.policy_version + 1 : value.policy_version } as T)} /></label> }

function ProjectKeys({ context }: { context: AppContext }) {
  const [keys, setKeys] = useState<ProjectKey[] | null>(null); const [error, setError] = useState<ApiError | null>(null); const [creating, setCreating] = useState(false); const [label, setLabel] = useState('浏览器生产 Key'); const [type, setType] = useState<ProjectKeyType>('browser'); const [secret, setSecret] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null)
  const load = async () => { try { setError(null); setKeys((await api.keys(context.tenant.id, context.project.id)).items) } catch (value) { setError(value as ApiError) } }
  useEffect(() => { void load() }, [context.tenant.id, context.project.id])
  const create = async (event: FormEvent) => { event.preventDefault(); setBusy('create'); try { const result = await api.createKey(context.tenant.id, context.project.id, { label, key_type: type }); setSecret(result.secret); setKeys(current => current ? [result.key, ...current] : [result.key]); setCreating(false) } catch (value) { setError(value as ApiError) } finally { setBusy(null) } }
  const rotate = async (key: ProjectKey) => { setBusy(key.id); try { const result = await api.rotateKey(context.tenant.id, context.project.id, key.id, {}); setSecret(result.secret); await load() } catch (value) { setError(value as ApiError) } finally { setBusy(null) } }
  const disable = async (key: ProjectKey) => { setBusy(key.id); try { await api.disableKey(context.tenant.id, context.project.id, key.id); await load() } catch (value) { setError(value as ApiError) } finally { setBusy(null) } }
  return <div className="key-section"><Header title="项目 Key" detail="密钥仅在创建或轮换后显示一次。浏览器 Key 可公开放入前端，必须限制允许的 Origin。" actions={<ConsoleButton onClick={() => setCreating(true)}>创建 Key</ConsoleButton>} />
    {secret && <SecretNotice secret={secret} onDismiss={() => setSecret(null)} />}{error && <Problem error={error} />}{creating && <form className="panel key-create" onSubmit={create}><label>标签<ConsoleInput required value={label} onChange={event => setLabel(event.target.value)} maxLength={200} /></label><label>用途<ConsoleSelect value={type} onChange={event => setType(event.target.value as ProjectKeyType)}><option value="browser">浏览器 SDK</option><option value="server">服务端</option><option value="mobile">移动端</option><option value="otel">OpenTelemetry</option><option value="sourcemap_upload">Source Map 上传</option></ConsoleSelect></label><div className="actions"><ConsoleButton type="submit" disabled={busy === 'create'}>{busy === 'create' ? '正在创建…' : '创建并显示一次'}</ConsoleButton><ConsoleButton type="button" className="secondary" onClick={() => setCreating(false)}>取消</ConsoleButton></div></form>}
    {!keys ? <Loading /> : !keys.length ? <Empty title="还没有项目 Key" detail="创建一个浏览器 Key 后即可接入 SDK。" /> : <Table headers={['标签', '类型', '前缀', '创建时间', '状态', '操作']} rows={keys.map(key => [key.label, key.key_type, <code key="prefix">{key.prefix}…</code>, formatTime(key.created_at), key.disabled_at ? '已禁用' : '启用中', key.disabled_at ? '—' : <span className="key-actions" key="actions"><ConfirmAction label="轮换" title={`轮换 Key「${key.label}」？`} impact="旧 Key 会立即失效；请先准备好使用新 Key 的部署或配置。" confirmLabel="确认轮换" disabled={busy === key.id} onConfirm={() => void rotate(key)} /><ConfirmAction label="禁用" title={`禁用 Key「${key.label}」？`} impact="使用该 Key 的后续采集请求会被拒绝，直到创建或轮换新的 Key。" confirmLabel="确认禁用" disabled={busy === key.id} onConfirm={() => void disable(key)} /></span>])} />}
  </div>
}

function SecretNotice({ secret, onDismiss }: { secret: string; onDismiss: () => void }) { const copy = async () => { try { await navigator.clipboard.writeText(secret) } catch { /* Browser fallback keeps the visible value available for manual copy. */ } }; return <div className="secret-notice"><strong>请现在保存新 Key</strong><code>{secret}</code><div className="actions"><ConsoleButton type="button" className="secondary" onClick={() => void copy()}>复制</ConsoleButton><ConsoleButton type="button" className="secondary" onClick={onDismiss}>我已保存</ConsoleButton></div></div> }

function SdkIntegrationPage({ context }: { context: AppContext }) {
  const [keys, setKeys] = useState<ProjectKey[] | null>(null); const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => { const controller = new AbortController(); api.keys(context.tenant.id, context.project.id, controller.signal).then(result => setKeys(result.items)).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) }); return () => controller.abort() }, [context.tenant.id, context.project.id])
  const browserKey = keys?.find(key => key.key_type === 'browser' && !key.disabled_at)
  const install = "pnpm add @zhiji-labs/browser-sdk"
  const configuredTrackIds = context.project.behavior_capture.track_ids
  const initialize = `import { initFromConfig } from '@zhiji-labs/browser-sdk'\n\nconst zhiji = await initFromConfig({\n  key: '${browserKey ? `${browserKey.prefix}…` : '创建浏览器 Key 后填入完整 Key'}',\n  origin: '${location.origin}',\n  release: import.meta.env.VITE_APP_VERSION,\n  performance: ${context.project.performance_capture.enabled},\n})`
  const behaviorMarker = `<button data-zj-track-id="${configuredTrackIds[0]}">\n  提交\n</button>`
  const identity = `// 登录成功后，由你的业务服务签发短期、一次性的 assertion。\nawait zhiji.login(user.id, response.identity_assertion, { plan: user.plan })\n\n// 退出时只清除当前登录关联；浏览器 visitor_id 保持稳定。\nzhiji.logout()`
  const planned = (title: string, detail: string) => <ConsoleCard className="panel"><ConsoleBadge variant="secondary">计划中</ConsoleBadge><h2>{title}</h2><p className="help">{detail}。当前不会提供不可执行的安装命令或虚构接入状态。</p></ConsoleCard>
  return <section><Header title="SDK 与构建接入" detail="按运行环境选择已发布 SDK；每种接入使用对应类型 Key。" />{error && <Problem error={error} />}<Tabs defaultValue="browser"><TabsList variant="line"><TabsTrigger value="browser">Browser</TabsTrigger><TabsTrigger value="node">Node</TabsTrigger><TabsTrigger value="python">Python</TabsTrigger><TabsTrigger value="mobile">Mobile</TabsTrigger></TabsList><TabsContent value="browser"><div className="sdk-steps"><ConsoleCard className="panel"><h2>接入状态</h2><ol className="checklist"><li>{context.project.allowed_origins.length ? `已配置 ${context.project.allowed_origins.length} 个允许 Origin。` : '待配置：先在项目设置中登记允许 Origin。'}</li><li>{browserKey ? `已找到浏览器 Key ${browserKey.prefix}…` : '待创建：创建一个启用中的浏览器 Key。'}</li><li>完成初始化后回到项目概览，检查第一条数据。</li></ol></ConsoleCard><DocBlock title="1. 安装" code={install} /><DocBlock title="2. 加载策略并初始化" code={initialize} />{context.project.behavior_capture.enabled && configuredTrackIds.length > 0 && <DocBlock title="3. 可选：标记关键元素" code={behaviorMarker} />}</div><details className="panel sdk-advanced"><summary>高级：业务登录与匿名 visitor 关联</summary><p className="help">浏览器匿名 visitor_id 保持在浏览器端；登录时以短期 assertion 关联到业务用户，退出只清除当前登录关联。</p><DocBlock title="4. 登录 / 退出" code={identity} /></details></TabsContent><TabsContent value="node">{planned('Node SDK', '服务端 SDK 正在准备发布')}</TabsContent><TabsContent value="python">{planned('Python SDK', 'Python SDK 正在完成发布与包元数据')}</TabsContent><TabsContent value="mobile">{planned('Mobile SDK', 'React Native 与原生移动端接入正在规划')}</TabsContent></Tabs></section>
}

function DocBlock({ title, code }: { title: string; code: string }) { const [copied, setCopied] = useState(false); const [failed, setFailed] = useState(false); const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setFailed(false); setTimeout(() => setCopied(false), 1500) } catch { setFailed(true) } }; return <div className="doc-block"><div><h2>{title}</h2><ConsoleButton className="secondary" onClick={() => void copy()}>{copied ? '已复制' : '复制'}</ConsoleButton></div><pre><code>{code}</code></pre>{failed && <p className="help" role="status">无法访问剪贴板，代码仍可手动选择复制。</p>}</div> }

function supportedDefinition(kind: InsightKind, subjectKind: FunnelSubjectKind, days: number, fields: { events: string; steps: string; start: string; returned: string; period: RetentionPeriod; periodCount: number; depth: number }): SavedInsightDefinition {
  const to = new Date(); const from = new Date(to.getTime() - days * 86_400_000)
  const base = { schema_version: 1 as const, kind, subject_kind: subjectKind, from: from.toISOString(), to: to.toISOString(), timezone: browserTimezone() }
  const csv = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean)
  if (kind === 'trend') return { ...base, event_names: csv(fields.events), granularity: 'day' }
  if (kind === 'funnel') return { ...base, steps: csv(fields.steps) }
  if (kind === 'retention') return { ...base, start_event: fields.start.trim(), return_event: fields.returned.trim(), period: fields.period, period_count: fields.periodCount }
  return { ...base, start_event: fields.start.trim(), depth: fields.depth }
}
function definitionSummary(definition: SavedInsightDefinition) {
  if (definition.kind === 'trend') return `趋势 · ${(definition.event_names ?? []).join('、') || '全部事件'}`
  if (definition.kind === 'funnel') return `漏斗 · ${(definition.steps ?? []).join(' → ')}`
  if (definition.kind === 'retention') return `留存 · ${definition.start_event} → ${definition.return_event}`
  return `路径 · ${definition.start_event}（${definition.depth} 层）`
}
function InsightFields({ kind, subjectKind, onKind, onSubjectKind, fields, onFields }: { kind: InsightKind; subjectKind: FunnelSubjectKind; onKind: (value: InsightKind) => void; onSubjectKind: (value: FunnelSubjectKind) => void; fields: { events: string; steps: string; start: string; returned: string; period: RetentionPeriod; periodCount: number; depth: number }; onFields: (next: { events: string; steps: string; start: string; returned: string; period: RetentionPeriod; periodCount: number; depth: number }) => void }) {
  const set = <K extends keyof typeof fields>(key: K, value: typeof fields[K]) => onFields({ ...fields, [key]: value })
  return <><div className="funnel-controls"><label>分析类型<ConsoleSelect value={kind} onChange={event => onKind(event.target.value as InsightKind)}><option value="trend">趋势</option><option value="funnel">漏斗</option><option value="retention">留存</option><option value="path">路径</option></ConsoleSelect></label><label>统计主体<ConsoleSelect value={subjectKind} onChange={event => onSubjectKind(event.target.value as FunnelSubjectKind)}><option value="visitor">访客</option><option value="business_user">业务用户（所有关联归属）</option></ConsoleSelect></label></div>
    {kind === 'trend' && <label>事件名（以逗号分隔，最多 6 个）<ConsoleInput value={fields.events} onChange={event => set('events', event.target.value)} maxLength={1200} placeholder="page_view, signup" /></label>}
    {kind === 'funnel' && <label>漏斗步骤（以逗号分隔，2–5 个）<ConsoleInput required value={fields.steps} onChange={event => set('steps', event.target.value)} maxLength={1000} placeholder="page_view, signup" /></label>}
    {kind === 'retention' && <div className="funnel-controls"><label>起始事件<ConsoleInput required value={fields.start} onChange={event => set('start', event.target.value)} maxLength={200} /></label><label>回访事件<ConsoleInput required value={fields.returned} onChange={event => set('returned', event.target.value)} maxLength={200} /></label><label>周期<ConsoleSelect value={fields.period} onChange={event => set('period', event.target.value as RetentionPeriod)}><option value="day">按天</option><option value="week">按周</option><option value="month">按月</option></ConsoleSelect></label><label>周期数<ConsoleSelect value={fields.periodCount} onChange={event => set('periodCount', Number(event.target.value))}><option value={1}>1</option><option value={3}>3</option><option value={7}>7</option><option value={12}>12</option></ConsoleSelect></label></div>}
    {kind === 'path' && <div className="funnel-controls"><label>起始事件<ConsoleInput required value={fields.start} onChange={event => set('start', event.target.value)} maxLength={200} /></label><label>路径深度<ConsoleSelect value={fields.depth} onChange={event => set('depth', Number(event.target.value))}><option value={2}>2 层</option><option value={3}>3 层</option><option value={4}>4 层</option><option value={5}>5 层</option></ConsoleSelect></label></div>}
  </>
}
function InsightsPage({ context }: { context: AppContext }) {
  const [items, setItems] = useState<SavedInsight[] | null>(null); const [editing, setEditing] = useState<SavedInsight | null>(null); const [creating, setCreating] = useState(false); const [error, setError] = useState<ApiError | null>(null)
  const load = async () => { try { setItems((await api.insights(context.tenant.id, context.project.id)).items) } catch (value) { setError(value as ApiError) } }
  useEffect(() => { setItems(null); setError(null); void load() }, [context.tenant.id, context.project.id])
  const archive = async (item: SavedInsight) => { try { await api.archiveInsight(context.tenant.id, context.project.id, item.id, item.definition_version); setItems(current => current?.filter(value => value.id !== item.id) ?? null) } catch (value) { setError(value as ApiError) } }
  return <section><Header title="保存洞察" detail="保存受支持的趋势、漏斗、留存或路径配置；不支持任意查询、SQL 或原始数据导出。" actions={<ConsoleButton onClick={() => { setEditing(null); setCreating(true) }}>保存新的洞察</ConsoleButton>} />{error && <Problem error={error} />}{creating && <InsightEditor context={context} initial={null} onCancel={() => setCreating(false)} onSaved={item => { setItems(current => [item, ...(current ?? [])]); setCreating(false) }} />}{editing && <InsightEditor context={context} initial={editing} onCancel={() => setEditing(null)} onSaved={item => { setItems(current => current?.map(value => value.id === item.id ? item : value) ?? [item]); setEditing(null) }} />}{!items ? <Loading /> : !items.length ? <Empty title="尚未保存洞察" detail="先在这里保存一个受支持的分析定义，再添加到项目仪表盘或创建报表计划。" /> : <Table headers={['名称', '定义', '可见范围', '版本', '更新时间', '操作']} rows={items.map(item => [<span key="name"><strong>{item.name}</strong>{item.description && <small className="muted">{item.description}</small>}</span>, definitionSummary(item.definition), item.visibility === 'project' ? '项目' : '仅自己', item.definition_version, formatTime(item.updated_at), <span className="key-actions" key="actions"><ConsoleButton className="secondary" onClick={() => { setCreating(false); setEditing(item) }}>编辑</ConsoleButton><ConfirmAction label="归档" title={`归档洞察「${item.name}」？`} impact="它会从项目列表和后续仪表盘选择中移除；已保存的历史不会被导出。" confirmLabel="确认归档" onConfirm={() => void archive(item)} /></span>])} />}</section>
}
function InsightEditor({ context, initial, onCancel, onSaved }: { context: AppContext; initial: SavedInsight | null; onCancel: () => void; onSaved: (item: SavedInsight) => void }) {
  const definition = initial?.definition
  const [name, setName] = useState(initial?.name ?? ''); const [description, setDescription] = useState(initial?.description ?? ''); const [visibility, setVisibility] = useState<InsightVisibility>(initial?.visibility ?? 'private'); const [kind, setKind] = useState<InsightKind>(definition?.kind ?? 'trend'); const [subjectKind, setSubjectKind] = useState<FunnelSubjectKind>(definition?.subject_kind ?? 'visitor'); const [days, setDays] = useState(30); const [fields, setFields] = useState({ events: definition?.event_names?.join(', ') ?? 'page_view', steps: definition?.steps?.join(', ') ?? 'page_view, signup', start: definition?.start_event ?? 'page_view', returned: definition?.return_event ?? 'page_view', period: definition?.period ?? 'day' as RetentionPeriod, periodCount: definition?.period_count ?? 7, depth: definition?.depth ?? 3 }); const [error, setError] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => { event.preventDefault(); const normalized = name.trim(); if (!normalized) return; setBusy(true); setError(null); try { const body = { name: normalized, description: description.trim() || null, visibility, definition: supportedDefinition(kind, subjectKind, days, fields) }; const saved = initial ? await api.updateInsight(context.tenant.id, context.project.id, initial.id, { ...body, expected_definition_version: initial.definition_version }) : await api.createInsight(context.tenant.id, context.project.id, body); onSaved(saved) } catch (value) { setError(value as ApiError) } finally { setBusy(false) } }
  return <form className="panel funnel-form" onSubmit={submit}><h2>{initial ? '编辑洞察' : '保存洞察'}</h2><label>名称<ConsoleInput required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label><label>说明（可选）<ConsoleInput maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label><div className="funnel-controls"><label>统计范围<ConsoleSelect value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option></ConsoleSelect></label><label>可见范围<ConsoleSelect value={visibility} onChange={event => setVisibility(event.target.value as InsightVisibility)}><option value="private">仅自己</option><option value="project">项目成员</option></ConsoleSelect></label></div><InsightFields kind={kind} subjectKind={subjectKind} onKind={setKind} onSubjectKind={setSubjectKind} fields={fields} onFields={setFields} /><p className="help">定义会以结构化字段保存，时间范围在保存时固定。更新使用当前定义版本，遇到并发修改请刷新后重试。</p>{error && <Problem error={error} />}<div className="actions"><ConsoleButton type="submit" disabled={busy}>{busy ? '正在保存…' : '保存'}</ConsoleButton><ConsoleButton type="button" className="secondary" onClick={onCancel}>取消</ConsoleButton></div></form>
}

function DashboardsPage({ context }: { context: AppContext }) {
  const [dashboards, setDashboards] = useState<SavedDashboard[] | null>(null); const [insights, setInsights] = useState<SavedInsight[] | null>(null); const [selected, setSelected] = useState<DashboardDetail | null>(null); const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [editorOpen, setEditorOpen] = useState(false); const [error, setError] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false)
  const choose = async (dashboard: SavedDashboard, edit = false) => { try { setError(null); const detail = await api.dashboard(context.tenant.id, context.project.id, dashboard.id); setSelected(detail); setName(detail.name); setDescription(detail.description ?? ''); setEditorOpen(edit) } catch (value) { setError(value as ApiError) } }
  const load = async () => { try { const [dashboardResult, insightResult] = await Promise.all([api.dashboards(context.tenant.id, context.project.id), api.insights(context.tenant.id, context.project.id)]); setDashboards(dashboardResult.items); setInsights(insightResult.items); if (dashboardResult.items[0]) await choose(dashboardResult.items[0]) } catch (value) { setError(value as ApiError) } }
  useEffect(() => { setDashboards(null); setInsights(null); setSelected(null); setEditorOpen(false); setError(null); void load() }, [context.tenant.id, context.project.id])
  const startCreate = () => { setSelected(null); setName(''); setDescription(''); setEditorOpen(true) }
  const create = async (event: FormEvent) => { event.preventDefault(); const normalized = name.trim(); if (!normalized) return; setBusy(true); try { const saved = await api.createDashboard(context.tenant.id, context.project.id, { name: normalized, description: description.trim() || null }); setDashboards(current => [saved, ...(current ?? [])]); await choose(saved) } catch (value) { setError(value as ApiError) } finally { setBusy(false) } }
  const update = async (event: FormEvent) => { event.preventDefault(); if (!selected || !name.trim()) return; setBusy(true); try { const saved = await api.updateDashboard(context.tenant.id, context.project.id, selected.id, { name: name.trim(), description: description.trim() || null, expected_version: selected.version }); setDashboards(current => current?.map(value => value.id === saved.id ? saved : value) ?? [saved]); setSelected({ ...selected, ...saved }); setEditorOpen(false) } catch (value) { setError(value as ApiError) } finally { setBusy(false) } }
  const archive = async () => { if (!selected) return; try { await api.archiveDashboard(context.tenant.id, context.project.id, selected.id, selected.version); const remaining = dashboards?.filter(value => value.id !== selected.id) ?? []; setDashboards(remaining); setSelected(null); setEditorOpen(false); if (remaining[0]) await choose(remaining[0]) } catch (value) { setError(value as ApiError) } }
  return <section><Header title="项目仪表盘" detail="先查看真实聚合结果，需要调整名称或瓷砖时再进入编辑。" actions={<ConsoleButton onClick={startCreate}>创建仪表盘</ConsoleButton>} />{error && <Problem error={error} />}
    {editorOpen && <form className="panel funnel-form" onSubmit={selected ? update : create}><h2>{selected ? `编辑「${selected.name}」` : '新建仪表盘'}</h2><label>名称<ConsoleInput required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label><label>说明（可选）<ConsoleInput maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label><div className="actions"><ConsoleButton type="submit" disabled={busy}>{busy ? '正在保存…' : selected ? '保存更改' : '创建仪表盘'}</ConsoleButton><ConsoleButton type="button" className="secondary" onClick={() => { setEditorOpen(false); if (!selected && dashboards?.[0]) void choose(dashboards[0]) }}>取消</ConsoleButton>{selected && <ConfirmAction label="归档仪表盘" title={`归档仪表盘「${selected.name}」？`} impact="它会从项目仪表盘和后续报表选择中移除；其中引用的保存洞察不会被删除。" confirmLabel="确认归档" disabled={busy} onConfirm={() => void archive()} />}</div></form>}
    {!dashboards ? <Loading /> : !dashboards.length && !editorOpen ? <ConsoleEmpty className="empty" variant="card"><span className="empty-orbit" aria-hidden="true"><i /><b>▤</b></span><h2>还没有仪表盘</h2><p>创建一个仪表盘，把保存洞察组合成团队可以直接查看的项目视图。</p><ConsoleButton onClick={startCreate}>创建第一个仪表盘 <span aria-hidden="true">→</span></ConsoleButton></ConsoleEmpty> : dashboards.length ? <ConsoleCard className="panel dashboard-picker"><div><h2>已有仪表盘</h2><p className="help">选择后直接查看最新聚合预览。</p></div><div className="actions">{dashboards.map(item => <ConsoleButton className={selected?.id === item.id ? '' : 'secondary'} key={item.id} onClick={() => void choose(item)}>{item.name}</ConsoleButton>)}</div></ConsoleCard> : null}
    {selected && <><DashboardPreview context={context} dashboard={selected} /><details className="panel dashboard-editor"><summary>编辑仪表盘内容</summary><div className="actions"><ConsoleButton className="secondary" onClick={() => setEditorOpen(true)}>编辑名称与说明</ConsoleButton></div><DashboardTiles context={context} dashboard={selected} insights={insights ?? []} onSaved={value => { setSelected(value); setDashboards(current => current?.map(item => item.id === value.id ? value : item) ?? [value]) }} /></details></>}
  </section>
}
type DashboardTileResult = { kind: 'trend'; points: TrendPoint[] } | { kind: 'funnel'; result: FunnelResult } | { kind: 'retention'; result: RetentionResult } | { kind: 'path'; result: PathResult }
function definitionKindLabel(kind: InsightKind) { return ({ trend: '事件趋势', funnel: '漏斗分析', retention: '留存分析', path: '路径分析' })[kind] }
function DashboardPreview({ context, dashboard }: { context: AppContext; dashboard: DashboardDetail }) {
  const tiles = [...dashboard.tiles].sort((left, right) => left.position - right.position)
  return <section className="dashboard-preview" aria-label={`${dashboard.name} 数据预览`}><header><div><span>查看模式</span><h2>{dashboard.name}</h2>{dashboard.description && <p>{dashboard.description}</p>}</div><ConsoleBadge variant="outline">{tiles.length} 个洞察</ConsoleBadge></header>{tiles.length ? <div className="dashboard-preview-grid">{tiles.map(tile => <DashboardTilePreview key={`${tile.id}:${tile.tile_version}`} context={context} tile={tile} />)}</div> : <Empty title="仪表盘还没有内容" detail="展开下方编辑区，选择已保存的洞察。" />}</section>
}
function DashboardTilePreview({ context, tile }: { context: AppContext; tile: DashboardDetail['tiles'][number] }) {
  const [data, setData] = useState<DashboardTileResult | null>(null); const [error, setError] = useState<ApiError | null>(null)
  const insight = tile.insight
  useEffect(() => {
    if (!insight) return
    const controller = new AbortController(); const definition = insight.definition; const query = new URLSearchParams({ from: definition.from, to: definition.to, timezone: definition.timezone, subject_kind: definition.subject_kind })
    let request: Promise<DashboardTileResult>
    if (definition.kind === 'trend') { query.set('event_names', (definition.event_names ?? ['page_view']).join(',')); query.set('granularity', definition.granularity ?? 'day'); request = api.trend(context.tenant.id, context.project.id, query, controller.signal).then(value => ({ kind: 'trend', points: value.points })) }
    else if (definition.kind === 'funnel') { query.set('steps', (definition.steps ?? []).join(',')); request = api.funnel(context.tenant.id, context.project.id, query, controller.signal).then(result => ({ kind: 'funnel', result })) }
    else if (definition.kind === 'retention') { query.set('start_event', definition.start_event ?? 'page_view'); query.set('return_event', definition.return_event ?? 'page_view'); query.set('period', definition.period ?? 'day'); query.set('period_count', String(definition.period_count ?? 7)); request = api.retention(context.tenant.id, context.project.id, query, controller.signal).then(result => ({ kind: 'retention', result })) }
    else { query.set('start_event', definition.start_event ?? 'page_view'); query.set('depth', String(definition.depth ?? 3)); request = api.pathAnalysis(context.tenant.id, context.project.id, query, controller.signal).then(result => ({ kind: 'path', result })) }
    setData(null); setError(null); request.then(setData).catch(value => { if (!(value instanceof DOMException)) setError(value as ApiError) }); return () => controller.abort()
  }, [context.tenant.id, context.project.id, tile.id, tile.tile_version, insight])
  return <ConsoleCard className="dashboard-preview-tile"><header><div><small>{insight ? definitionKindLabel(insight.kind) : '洞察不可用'}</small><h3>{tile.title_override || insight?.name || '已归档洞察'}</h3></div></header>{!insight ? <p className="muted">引用的洞察已不可用。</p> : error ? <Problem error={error} /> : !data ? <Loading /> : data.kind === 'trend' ? data.points.length ? <><TrendChart points={data.points} /><p className="help">合计 {number(data.points.reduce((sum, point) => sum + point.event_count, 0))} 次事件</p></> : <Empty title="当前范围没有趋势数据" /> : data.kind === 'funnel' ? data.result.source_event_count ? <><FunnelChart steps={data.result.steps} /><p className="help">来源事件 {number(data.result.source_event_count)}</p></> : <Empty title="当前范围没有漏斗数据" /> : data.kind === 'retention' ? data.result.cohorts.length ? <Table headers={['Cohort', '起始人数', '最近一期']} rows={data.result.cohorts.slice(0, 5).map(cohort => [formatDate(cohort.cohort_start), number(cohort.cohort_size), cohort.retained.length ? `${cohort.retained.at(-1)?.rate.toFixed(2)}%` : '—'])} /> : <Empty title="当前范围没有留存数据" /> : data.result.levels.some(level => level.nodes.length) ? <Table headers={['层级', '下一步', '主体数']} rows={data.result.levels.flatMap(level => level.nodes.slice(0, 5).map(node => [level.depth, node.name, number(node.count)]))} /> : <Empty title="当前范围没有路径数据" />}</ConsoleCard>
}
function DashboardTiles({ context, dashboard, insights, onSaved }: { context: AppContext; dashboard: DashboardDetail; insights: SavedInsight[]; onSaved: (value: DashboardDetail) => void }) {
  const currentIds = [...dashboard.tiles].sort((a, b) => a.position - b.position).map(tile => tile.saved_insight_id); const [selectedIds, setSelectedIds] = useState(currentIds); const [error, setError] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false)
  useEffect(() => setSelectedIds([...dashboard.tiles].sort((a, b) => a.position - b.position).map(tile => tile.saved_insight_id)), [dashboard.id, dashboard.version])
  const save = async () => { setBusy(true); setError(null); try { const old = new Map(dashboard.tiles.map(tile => [tile.saved_insight_id, tile])); const result = await api.replaceDashboardTiles(context.tenant.id, context.project.id, dashboard.id, { expected_version: dashboard.version, tiles: selectedIds.slice(0, 24).map((saved_insight_id, position) => { const tile = old.get(saved_insight_id); return { ...(tile ? { id: tile.id, tile_version: tile.tile_version } : {}), saved_insight_id, position, width: 6, height: 3, title_override: null } }) }); onSaved(result) } catch (value) { setError(value as ApiError) } finally { setBusy(false) } }
  const toggle = (id: string, checked: boolean) => setSelectedIds(current => checked ? [...current, id].slice(0, 24) : current.filter(value => value !== id))
  return <ConsoleCard className="panel"><h2>仪表盘瓷砖</h2><p className="help">选择最多 24 个保存洞察。布局使用固定安全尺寸；每次保存都带仪表盘版本，防止覆盖其他人的调整。</p>{!insights.length ? <Empty title="没有可添加的洞察" detail="先保存一个项目可见的洞察。" /> : <>{insights.map(insight => <label className="inline-toggle" key={insight.id}><ConsoleInput type="checkbox" checked={selectedIds.includes(insight.id)} onChange={event => toggle(insight.id, event.target.checked)} /><span><strong>{insight.name}</strong> · {definitionSummary(insight.definition)}</span></label>)}{error && <Problem error={error} />}<div className="actions"><ConsoleButton disabled={busy} onClick={() => void save()}>{busy ? '正在保存…' : '保存瓷砖'}</ConsoleButton></div></>}</ConsoleCard>
}
function ReportSchedulesPage({ context }: { context: AppContext }) {
  const [schedules, setSchedules] = useState<ReportSchedule[] | null>(null); const [insights, setInsights] = useState<SavedInsight[]>([]); const [dashboards, setDashboards] = useState<SavedDashboard[]>([]); const [targets, setTargets] = useState<AlertTarget[]>([]); const [targetType, setTargetType] = useState<'insight' | 'dashboard'>('insight'); const [targetId, setTargetId] = useState(''); const [notificationTargetId, setNotificationTargetId] = useState(''); const [cadence, setCadence] = useState<ReportCadence>('weekly'); const [nextRunAt, setNextRunAt] = useState(''); const [error, setError] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false)
  const load = async () => { try { const [scheduleResult, insightResult, dashboardResult, notificationResult] = await Promise.all([api.reportSchedules(context.tenant.id, context.project.id), api.insights(context.tenant.id, context.project.id), api.dashboards(context.tenant.id, context.project.id), api.alertTargets(context.tenant.id, context.project.id, new URLSearchParams({ limit: '100' }))]); setSchedules(scheduleResult.items); setInsights(insightResult.items); setDashboards(dashboardResult.items); setTargets(notificationResult.items.filter(item => item.enabled && !!item.verified_at && !item.disabled_at)) } catch (value) { setError(value as ApiError) } }
  useEffect(() => { setSchedules(null); setError(null); void load() }, [context.tenant.id, context.project.id])
  const candidates = targetType === 'insight' ? insights : dashboards
  useEffect(() => setTargetId(candidates[0]?.id ?? ''), [targetType, insights.length, dashboards.length])
  useEffect(() => setNotificationTargetId(targets[0]?.id ?? ''), [targets.length])
  const create = async (event: FormEvent) => { event.preventDefault(); if (!targetId || !notificationTargetId || !nextRunAt) return; setBusy(true); try { const created = await api.createReportSchedule(context.tenant.id, context.project.id, { target_type: targetType, target_id: targetId, cadence, timezone: browserTimezone(), next_run_at: new Date(nextRunAt).toISOString(), enabled: true, notification_target_id: notificationTargetId }); setSchedules(current => [created, ...(current ?? [])]); setNextRunAt('') } catch (value) { setError(value as ApiError) } finally { setBusy(false) } }
  const toggle = async (schedule: ReportSchedule, enabled: boolean) => { try { const updated = enabled ? await api.updateReportSchedule(context.tenant.id, context.project.id, schedule.id, { expected_updated_at: schedule.updated_at, enabled: true }) : await api.disableReportSchedule(context.tenant.id, context.project.id, schedule.id, schedule.updated_at); setSchedules(current => current?.map(value => value.id === updated.id ? updated : value) ?? [updated]) } catch (value) { setError(value as ApiError) } }
  const targetName = (schedule: ReportSchedule) => (schedule.target_type === 'insight' ? insights : dashboards).find(value => value.id === schedule.target_id)?.name ?? '已归档目标'
  return <section><Header title="报表计划" detail="定时发送已保存洞察或仪表盘。通知地址、Webhook 与凭据永远不会在此页面或 API 中显示。" />{error && <Problem error={error} />}<form className="panel funnel-form" onSubmit={create}><h2>新建报表计划</h2><div className="funnel-controls"><label>报表类型<ConsoleSelect value={targetType} onChange={event => setTargetType(event.target.value as 'insight' | 'dashboard')}><option value="insight">保存洞察</option><option value="dashboard">仪表盘</option></ConsoleSelect></label><label>报表内容<ConsoleSelect required value={targetId} onChange={event => setTargetId(event.target.value)}>{candidates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</ConsoleSelect></label><label>频率<ConsoleSelect value={cadence} onChange={event => setCadence(event.target.value as ReportCadence)}><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></ConsoleSelect></label><label>下次运行时间<ConsoleInput type="datetime-local" required value={nextRunAt} onChange={event => setNextRunAt(event.target.value)} /></label></div><label>通知目标<ConsoleSelect required value={notificationTargetId} onChange={event => setNotificationTargetId(event.target.value)}>{targets.map(target => <option key={target.id} value={target.id}>{target.label}（{target.type}）</option>)}</ConsoleSelect></label><p className="help">只显示已验证目标的标签和类型，绝不显示其地址、Webhook 或密钥。下次运行时间必须在未来。</p><ConsoleButton type="submit" disabled={busy || !candidates.length || !targets.length}>{busy ? '正在创建…' : '创建计划'}</ConsoleButton></form>{!schedules ? <Loading /> : !schedules.length ? <Empty title="尚未创建报表计划" detail="创建后由 Worker 按计划生成聚合报告并投递到受控通知目标。" /> : <Table headers={['内容', '频率', '时区', '下次运行', '状态', '最近一次', '操作']} rows={schedules.map(schedule => [targetName(schedule), cadenceLabel(schedule.cadence), schedule.timezone, formatTime(schedule.next_run_at), schedule.enabled ? '启用中' : '已停用', schedule.latest_run ? `${schedule.latest_run.status}${schedule.latest_run.finished_at ? ` · ${formatTime(schedule.latest_run.finished_at)}` : ''}` : '尚未运行', schedule.enabled ? <ConfirmAction key="toggle" label="停用" title={`停用「${targetName(schedule)}」报表计划？`} impact={`该计划将停止按${cadenceLabel(schedule.cadence)}生成并发送后续报告；已经完成的报告不受影响。`} confirmLabel="确认停用" onConfirm={() => void toggle(schedule, false)} /> : <ConsoleButton key="toggle" className="secondary" onClick={() => void toggle(schedule, true)}>重新启用</ConsoleButton>])} />}</section>
}
function cadenceLabel(value: ReportCadence) { return ({ daily: '每天', weekly: '每周', monthly: '每月' })[value] }

function Header({ title, detail, actions }: { title: string; detail?: string; actions?: ReactNode }) { const page = consolePageInfo(currentRoute().kind); return <div className="page-heading"><p className="page-eyebrow"><span aria-hidden="true" />{page.category}</p><ConsolePageHeader className="page-header" title={title} description={detail} actions={actions && <div className="actions">{actions}</div>} /></div> }
function Loading() { return <ConsoleCard className="panel loading-state" role="status" aria-live="polite"><div className="loading-skeleton" aria-hidden="true"><i /><i /><i /></div><div><ConsoleSpinner /><span>正在加载数据…</span></div></ConsoleCard> }
function Empty({ title, detail, action }: { title: string; detail?: string; action?: { label: string; href: string } }) {
  return <ConsoleEmpty className="empty" variant="card"><span className="empty-orbit" aria-hidden="true"><i /><b>⌁</b></span><h2>{title}</h2>{detail && <p>{detail}</p>}{action && <ConsoleButton onClick={() => navigate(action.href)}>{action.label}<span aria-hidden="true">→</span></ConsoleButton>}</ConsoleEmpty>
}
function PageMessage({ title, detail }: { title: string; detail?: string }) { return <main className="center"><h1>{title}</h1>{detail && <p>{detail}</p>}</main> }
function Problem({ error }: { error: ApiError }) { return <ConsoleAlert className="problem" variant="destructive"><ConsoleAlertTitle>{error.code === 'authentication_required' ? '登录已失效' : error.status === 403 ? '当前角色没有访问权限' : error.status === 429 ? '请求过于频繁，请稍后重试' : '操作未完成'}</ConsoleAlertTitle><ConsoleAlertDescription>{error.message}{error.requestId && <small>请求 ID：{error.requestId}</small>}</ConsoleAlertDescription></ConsoleAlert> }
function Status({ status }: { status: ErrorGroup['status'] }) { const labels = { unresolved: '未解决', resolved: '已解决', ignored: '已忽略' }; const variant = status === 'unresolved' ? 'destructive' : 'secondary'; return <ConsoleBadge className={`status ${status}`} variant={variant} dot>{labels[status]}</ConsoleBadge> }
function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) { return <div className="table-wrap" role="region" aria-label={headers.join('、')} tabIndex={0}><ConsoleTable className="data-table" density="comfortable"><ConsoleTableHeader><ConsoleTableRow>{headers.map(header => <ConsoleTableHead key={header} scope="col">{header}</ConsoleTableHead>)}</ConsoleTableRow></ConsoleTableHeader><ConsoleTableBody>{rows.map((row, i) => <ConsoleTableRow key={i}>{row.map((cell, index) => <ConsoleTableCell key={index}>{cell}</ConsoleTableCell>)}</ConsoleTableRow>)}</ConsoleTableBody></ConsoleTable></div> }
function browserTimezone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }
function periodLabel(period: RetentionPeriod) { return ({ day: '按天', week: '按周', month: '按月' })[period] }
function formatDate(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value)) }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function number(value: number) { return value.toLocaleString('zh-CN') }
function formatBytes(value: number) { if (value < 1024) return `${number(value)} B`; if (value < 1_048_576) return `${(value / 1024).toFixed(1)} KB`; if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`; return `${(value / 1_073_741_824).toFixed(2)} GB` }
function formatMetric(item: PerformanceMetric) { if (item.p75 === null) return '—'; return item.metric_name === 'CLS' ? item.p75.toFixed(3) : `${Math.round(item.p75)} ms` }
