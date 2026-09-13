import { useEffect, useState } from 'react'
import { ApiClient, ApiError, type Project, type Tenant, type ProjectKey } from './api'
import { ConsoleBadge, ConsoleButton, ConsoleCard } from './ui'

type Props = { api: ApiClient; project: Project; tenant: Tenant; navigate: (path: string) => void; onVerify: () => void }

/** Connection guidance reflects configuration only; it never pretends SDK delivery is verified. */
export function ConnectionGuide({ api, project, tenant, navigate, onVerify }: Props) {
  const [keys, setKeys] = useState<ProjectKey[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [platform, setPlatform] = useState<'browser' | 'server' | 'mobile'>('browser')
  useEffect(() => {
    const controller = new AbortController()
    api.keys(tenant.id, project.id, controller.signal).then(result => setKeys(result.items)).catch(error => { if (!controller.signal.aborted) setFailure(error instanceof ApiError ? error.message : '暂时无法读取 Key 状态') })
    return () => controller.abort()
  }, [api, project.id, tenant.id])
  const readyKey = keys?.some(key => key.key_type === platform && !key.disabled_at)
  const browser = platform === 'browser'
  const originReady = project.allowed_origins.length > 0
  const label = platform === 'browser' ? '网站 / Web 应用' : platform === 'server' ? '服务端' : '移动应用'
  const doc = platform === 'browser' ? '/docs/sdk/browser' : platform === 'server' ? '/docs/sdk/server' : '/docs/sdk/mobile'
  return <ConsoleCard className="setup-empty connection-guide" variant="card">
    <div className="connection-heading"><div><ConsoleBadge variant="secondary">接入指南</ConsoleBadge><h2>{readyKey ? '已有接入 Key，接下来验证数据。' : '把第一个系统接到知迹。'}</h2><p>从一个系统、一条事件开始。当前最近 7 天没有数据，完成接入或检查现有配置后，回来验证接收结果。</p></div><span className="connection-emblem" aria-hidden="true">⌁</span></div>
    <div className="connection-platforms" role="group" aria-label="选择接入的系统类型">{([['browser', '网站 / Web 应用', '页面访问、事件和错误'], ['server', '服务端', '业务事件和服务异常'], ['mobile', '移动应用', 'React Native 事件']] as const).map(([value, title, detail]) => <ConsoleButton key={value} className={`secondary connection-platform${platform === value ? ' selected' : ''}`} aria-pressed={platform === value} onClick={() => setPlatform(value)}><strong>{title}</strong><small>{detail}</small></ConsoleButton>)}</div>
    <ol className="connection-steps">
      <li className="complete"><span>✓</span><div><strong>项目已创建</strong><small>{project.name} · 后续数据会归入此项目</small></div></li>
      <li className={browser && originReady ? 'complete' : ''}><span>{browser && originReady ? '✓' : '02'}</span><div><strong>{browser ? '配置网站来源' : '确认接入环境'}</strong><small>{browser ? originReady ? `已登记 ${project.allowed_origins.length} 个 Origin` : '登记网站 Origin 与允许采集的页面。' : platform === 'mobile' ? '创建 Key 时登记应用 ID、平台与版本范围。' : '将 server Key 保存在服务端环境变量。'}</small><ConsoleButton className="link" onClick={() => navigate('/settings')}>检查项目配置 →</ConsoleButton></div></li>
      <li className={readyKey ? 'complete' : ''}><span>{readyKey ? '✓' : '03'}</span><div><strong>{readyKey ? '接入 Key 已创建' : '创建接入 Key'}</strong><small>{keys === null ? failure ?? '正在读取 Key 状态…' : readyKey ? '使用已有完整 Key，无需重复创建。' : `为${label}创建独立 Key，完整值只显示一次。`}</small><ConsoleButton className="link" onClick={() => navigate('/settings?tab=keys')}>管理访问 Key →</ConsoleButton></div></li>
      <li><span>04</span><div><strong>接入并验证第一条事件</strong><small>按文档初始化 SDK，触发一次事件，再回来检查。未收到数据前不会标记为完成。</small><a href={doc}>阅读{label}接入文档 ↗</a></div></li>
    </ol>
    <div className="connection-verify"><div><strong>已经接入了？</strong><p>检查网络请求、Key 类型和项目归属，再重新查询最近 7 天的数据。</p></div><ConsoleButton onClick={onVerify}>检查是否收到数据 <span aria-hidden="true">↻</span></ConsoleButton></div>
    {failure && <p className="help" role="status">Key 状态未能确认：{failure}。可以先阅读接入文档。</p>}
  </ConsoleCard>
}
