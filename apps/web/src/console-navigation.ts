/** One navigation catalogue for the sidebar, breadcrumb and page category. */
export const consoleGroups = [
  { title: '工作空间', items: [{ kind: 'dashboard', href: '/', label: '项目概览', icon: '◫' }] },
  { title: '体验监控', items: [
    { kind: 'errors', href: '/errors', label: '错误中心', icon: '⊗' },
    { kind: 'performance', href: '/performance', label: '性能观测', icon: '↗' },
    { kind: 'heatmaps', href: '/heatmaps', label: '热力图', icon: '▦' },
    { kind: 'replays', href: '/replays', label: '会话回放', icon: '▷' },
    { kind: 'alerts', href: '/alerts', label: '告警与通知', icon: '◉' },
  ] },
  { title: '产品分析', items: [
    { kind: 'analytics', href: '/analytics', label: '事件分析', icon: '⌁' },
    { kind: 'funnels', href: '/funnels', label: '漏斗分析', icon: '▽' },
    { kind: 'retention', href: '/retention', label: '留存分析', icon: '↺' },
    { kind: 'paths', href: '/paths', label: '路径分析', icon: '⌘' },
    { kind: 'journeys', href: '/journeys', label: '用户旅程', icon: '↝' },
    { kind: 'cohorts', href: '/cohorts', label: '用户分群', icon: '◎' },
  ] },
  { title: '洞察与报表', items: [
    { kind: 'insights', href: '/insights', label: '保存洞察', icon: '◇' },
    { kind: 'dashboards', href: '/dashboards', label: '仪表盘', icon: '▤' },
    { kind: 'exports', href: '/exports', label: '导出任务', icon: '↓' },
    { kind: 'reportSchedules', href: '/report-schedules', label: '报表计划', icon: '◷' },
  ] },
  { title: '接入与管理', items: [
    { kind: 'sdk', href: '/sdk', label: 'SDK 接入', icon: '⌗' },
    { kind: 'settings', href: '/settings', label: '项目设置', icon: '⚙' },
    { kind: 'sourcemaps', href: '/sourcemaps', label: 'Source Map', icon: '⌥' },
    { kind: 'usage', href: '/usage', label: '项目用量', icon: '▥' },
    { kind: 'billing', href: '/billing', label: '套餐与配额', icon: '▣' },
    { kind: 'members', href: '/members', label: '成员与权限', icon: '⊕' },
    { kind: 'auditLogs', href: '/audit-logs', label: '审计日志', icon: '≡' },
    { kind: 'lifecycle', href: '/lifecycle', label: '数据生命周期', icon: '◴' },
    { kind: 'tenantSettings', href: '/tenant-settings', label: '租户默认策略', icon: '⚑' },
  ] },
] as const
export function consolePageInfo(kind: string) {
  for (const group of consoleGroups) {
    const item = group.items.find(item => item.kind === kind)
    if (item) return { ...item, category: group.title }
  }
  return { label: '页面未找到', category: '工作空间', icon: '◇', href: '/' }
}
