import { FormEvent, useEffect, useState } from 'react'
import { ApiClient, ApiError, BusinessUserSummary, UserJourneyResult, rangeQuery } from './api'
import { ConsoleAlert, ConsoleAlertDescription, ConsoleAlertTitle, ConsoleBadge, ConsoleButton, ConsoleCard, ConsoleEmpty, ConsoleInput, ConsolePageHeader, ConsoleSelect, ConsoleSpinner } from './ui'

type Scope = { tenantId: string; projectId: string }
type SelectedPerson = Scope & { businessUserId: string }

function journeyQuery(): { q: string; days: 7 | 30 | 90 } {
  const query = new URLSearchParams(location.search)
  const days = Number(query.get('days'))
  const q = (query.get('q') ?? '').trim().slice(0, 200)
  return { q, days: days === 7 || days === 30 || days === 90 ? days : 30 }
}

function updateJourneyQuery(updates: Record<'q' | 'days', string | undefined>) {
  const query = new URLSearchParams(location.search)
  for (const [key, value] of Object.entries(updates)) value ? query.set(key, value) : query.delete(key)
  history.pushState({}, '', `${location.pathname}${query.size ? `?${query}` : ''}${location.hash}`)
}

function isCurrentSelection(selection: SelectedPerson | null, scope: Scope): selection is SelectedPerson {
  return Boolean(selection && selection.tenantId === scope.tenantId && selection.projectId === scope.projectId)
}

function isCancelled(value: unknown) { return value instanceof DOMException && value.name === 'AbortError' }

export function UserJourneysPage({ api, scope }: { api: ApiClient; scope: Scope }) {
  const [search, setSearch] = useState(() => journeyQuery().q)
  const [submittedSearch, setSubmittedSearch] = useState(() => journeyQuery().q)
  const [people, setPeople] = useState<BusinessUserSummary[]>([])
  const [peopleLoading, setPeopleLoading] = useState(true)
  const [peopleError, setPeopleError] = useState<ApiError | null>(null)
  const [peopleRefresh, setPeopleRefresh] = useState(0)
  const [selected, setSelected] = useState<SelectedPerson | null>(null)
  const [journey, setJourney] = useState<UserJourneyResult | null>(null)
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [journeyError, setJourneyError] = useState<ApiError | null>(null)
  const [journeyRefresh, setJourneyRefresh] = useState(0)
  const [days, setDays] = useState<7 | 30 | 90>(() => journeyQuery().days)

  useEffect(() => {
    const sync = () => { const next = journeyQuery(); setSearch(next.q); setSubmittedSearch(next.q); setDays(next.days) }
    addEventListener('popstate', sync)
    return () => removeEventListener('popstate', sync)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ limit: '50', ...(submittedSearch ? { search: submittedSearch } : {}) })
    let active = true
    setPeopleLoading(true); setPeopleError(null); setPeople([])
    api.people(scope.tenantId, scope.projectId, query, controller.signal).then(result => {
      if (!active) return
      setPeople(result.items)
      setSelected(current => isCurrentSelection(current, scope) && result.items.some(item => item.business_user_id === current.businessUserId)
        ? current
        : result.items[0] ? { ...scope, businessUserId: result.items[0].business_user_id } : null)
    }).catch(value => { if (active && !isCancelled(value)) setPeopleError(value as ApiError) }).finally(() => { if (active) setPeopleLoading(false) })
    return () => { active = false; controller.abort() }
  }, [api, scope.tenantId, scope.projectId, submittedSearch, peopleRefresh])

  useEffect(() => {
    if (!isCurrentSelection(selected, scope)) { setJourney(null); setJourneyError(null); setJourneyLoading(false); return }
    const controller = new AbortController()
    const query = rangeQuery(days); query.set('limit', '200')
    let active = true
    setJourney(null); setJourneyError(null); setJourneyLoading(true)
    api.userJourney(scope.tenantId, scope.projectId, selected.businessUserId, query, controller.signal).then(result => { if (active) setJourney(result) }).catch(value => { if (active && !isCancelled(value)) setJourneyError(value as ApiError) }).finally(() => { if (active) setJourneyLoading(false) })
    return () => { active = false; controller.abort() }
  }, [api, scope.tenantId, scope.projectId, selected, days, journeyRefresh])

  const submit = (event: FormEvent) => { event.preventDefault(); const q = search.trim(); setSubmittedSearch(q); updateJourneyQuery({ q, days: String(days) }) }
  const changeDays = (value: 7 | 30 | 90) => { setDays(value); updateJourneyQuery({ q: submittedSearch || undefined, days: String(value) }) }
  return <section>
    <div className="page-heading"><p className="page-eyebrow"><span aria-hidden="true" />产品分析</p><ConsolePageHeader className="page-header" title="用户旅程" description="按已验证的业务用户查看近期页面访问与关键动作。只显示稳定路由和事件名，不展示原始属性、访客标识或页面内容。" /></div>
    <form className="panel journey-search" onSubmit={submit}><label>搜索用户<ConsoleInput name="q" autoComplete="off" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} placeholder="姓名、邮箱或业务用户 ID" /></label><ConsoleButton type="submit">搜索</ConsoleButton><label>时间范围<ConsoleSelect name="days" autoComplete="off" value={days} onChange={event => changeDays(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option></ConsoleSelect></label></form>
    {peopleLoading ? <Loading /> : peopleError ? <Problem error={peopleError} onRetry={peopleError.status === 403 ? undefined : () => setPeopleRefresh(value => value + 1)} /> : !people.length ? <Empty title="没有找到可查看的业务用户" detail="用户目录同步并完成身份关联后，会在这里显示近期活动。" /> : <div className="journey-layout">
      <ConsoleCard className="panel journey-people"><header><h2>业务用户</h2><span>{people.length} 人</span></header><div>{people.map(person => <button key={person.business_user_id} type="button" className={selected?.businessUserId === person.business_user_id ? 'active' : ''} onClick={() => setSelected({ ...scope, businessUserId: person.business_user_id })} aria-pressed={selected?.businessUserId === person.business_user_id}><strong>{person.display_name || person.email}</strong><span>{person.display_name ? person.email : `ID ${person.business_user_id}`}</span><small>{person.last_seen_at ? `${formatTime(person.last_seen_at)} · ${formatNumber(person.event_count)} 个事件` : '尚无已关联事件'}</small></button>)}</div></ConsoleCard>
      <ConsoleCard className="panel journey-detail">{journeyLoading ? <Loading compact /> : journeyError ? <Problem error={journeyError} onRetry={journeyError.status === 403 ? undefined : () => setJourneyRefresh(value => value + 1)} /> : !selected || !journey ? <Empty title="请选择业务用户" detail="从左侧目录选择一个业务用户后查看近期轨迹。" /> : <><header><div><p>当前用户</p><h2>{journey.profile.display_name || journey.profile.email}</h2><span>{journey.profile.department || '未同步部门'}{journey.profile.role ? ` · ${journey.profile.role}` : ''}</span></div><ConsoleBadge>{journey.profile.is_active ? '在职/有效' : '已停用'}</ConsoleBadge></header>{journey.items.length ? <ol className="journey-events">{journey.items.map((item, index) => <li key={`${item.occurred_at}:${index}`}><time dateTime={item.occurred_at}>{formatTime(item.occurred_at)}</time><span className={`journey-marker ${item.kind}`} aria-hidden="true" /><div><strong>{item.kind === 'page' ? pageLabel(item) : actionLabel(item.name)}</strong><code>{item.route || item.name}</code>{item.release && <small>版本 {item.release}</small>}</div></li>)}</ol> : <Empty title="当前范围没有用户轨迹" detail="只有身份关联成功后的页面访问和关键动作会出现在这里。" />}{journey.has_more && <p className="help">当前只显示最近 200 条，可缩短时间范围继续下探。</p>}</>}</ConsoleCard>
    </div>}
  </section>
}

function Loading({ compact = false }: { compact?: boolean }) { return <div className={compact ? 'journey-loading' : 'panel loading-state'} role="status"><ConsoleSpinner /><span>正在加载数据…</span></div> }
function Empty({ title, detail }: { title: string; detail: string }) { return <ConsoleEmpty className="empty" variant="card"><div className="empty-orbit" aria-hidden="true"><i /><b>⌁</b></div><h2>{title}</h2><p>{detail}</p></ConsoleEmpty> }
function Problem({ error, onRetry }: { error: ApiError; onRetry?: () => void }) { return <ConsoleAlert className="problem" variant="destructive"><ConsoleAlertTitle>{error.status === 403 ? '当前角色不能查看个人轨迹' : '用户旅程加载失败'}</ConsoleAlertTitle><ConsoleAlertDescription>{error.message}{error.requestId && <small>请求 ID：{error.requestId}</small>}{onRetry && <ConsoleButton className="secondary" type="button" onClick={onRetry}>重试</ConsoleButton>}</ConsoleAlertDescription></ConsoleAlert> }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) }
function formatNumber(value: number) { return new Intl.NumberFormat('zh-CN').format(value) }
function pageLabel(item: UserJourneyResult['items'][number]) { return item.name === 'page_view' ? '浏览页面' : '进入业务页面' }
function actionLabel(name: string) { const parts = name.split('.'); const action = parts.at(-2) ?? parts.at(-1) ?? name; return ({ export: '执行导出', download: '执行下载', save: '保存内容', submit: '提交操作', create: '创建内容', retry: '重试操作', approve: '审批通过', reject: '驳回操作' } as Record<string, string>)[action] ?? '关键操作' }
