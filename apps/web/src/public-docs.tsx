import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Button } from '@zhiji/design/button'
import { Card } from '@zhiji/design/card'
import './public-docs.css'

type LinkProps = { href: string; children: ReactNode; className?: string; onClick?: () => void }
type PublicPage = 'docs' | 'quickstart' | 'browser-sdk' | 'server-sdk' | 'mobile-sdk' | 'ingestion' | 'identity' | 'privacy' | 'operations' | 'changelog'

export function DocsPages({ page, Link }: { page: string; Link: ComponentType<LinkProps> }) {
  if (page === 'docs') return <DocsIndex Link={Link} />
  return <Article page={page as Exclude<PublicPage, 'docs'>} Link={Link} />
}

const navigation = [
  { group: '开始使用', items: [['快速开始', '/docs/quickstart', 'quickstart'], ['身份关联', '/docs/identity', 'identity'], ['采集协议', '/docs/ingestion', 'ingestion']] },
  { group: 'SDK', items: [['浏览器 SDK', '/docs/sdk/browser', 'browser-sdk'], ['Node SDK（计划中）', '/docs/sdk/server', 'server-sdk'], ['移动端 SDK（计划中）', '/docs/sdk/mobile', 'mobile-sdk']] },
  { group: '部署与参考', items: [['隐私与页面键', '/docs/privacy', 'privacy'], ['部署与运维', '/docs/operations', 'operations'], ['变更记录', '/docs/changelog', 'changelog']] },
] as const

const cards = [
  { title: '快速开始', desc: '用一个安全的页面事件，验证从浏览器到工作台的完整链路。', href: '/docs/quickstart', tag: '5 分钟', group: '开始使用', page: 'quickstart' },
  { title: '身份关联', desc: '把匿名访问与登录后的业务用户正确地关联起来。', href: '/docs/identity', tag: '核心概念', group: '开始使用', page: 'identity' },
  { title: '采集协议', desc: '理解事件、错误、行为、回放和性能的独立入口。', href: '/docs/ingestion', tag: '接口参考', group: '开始使用', page: 'ingestion' },
  { title: '浏览器 SDK', desc: '接入 Web 事件、错误和按策略开启的体验数据。', href: '/docs/sdk/browser', tag: 'TypeScript', group: 'SDK', page: 'browser-sdk' },
  { title: 'Node SDK', desc: '服务端 SDK 正在准备公开发布，当前请直接使用采集协议。', href: '/docs/sdk/server', tag: '计划中', group: 'SDK', page: 'server-sdk' },
  { title: '移动端 SDK', desc: 'React Native SDK 正在准备公开发布，当前不提供安装指令。', href: '/docs/sdk/mobile', tag: '计划中', group: 'SDK', page: 'mobile-sdk' },
  { title: '隐私与页面键', desc: '用稳定的页面键和最小化采集，守住数据边界。', href: '/docs/privacy', tag: '必读', group: '部署与参考', page: 'privacy' },
  { title: '部署与运维', desc: '准备 HTTPS、数据库、Worker、备份和恢复流程。', href: '/docs/operations', tag: '自部署', group: '部署与参考', page: 'operations' },
  { title: '变更记录', desc: '查看协议和 SDK 能力的公开变更。', href: '/docs/changelog', tag: '更新', group: '部署与参考', page: 'changelog' },
]

function DocsIndex({ Link }: { Link: ComponentType<LinkProps> }) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    addEventListener('keydown', focusSearch)
    return () => removeEventListener('keydown', focusSearch)
  }, [])
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized ? cards.filter(card => `${card.title} ${card.desc} ${card.tag}`.toLowerCase().includes(normalized)) : cards
  }, [query])
  return <div className="pub-docs pub-docs-index">
    <section className="pub-docs-hero">
      <div className="pub-docs-wrap">
        <p className="pub-docs-kicker"><i /> 知迹文档</p>
        <h1>从接入第一条事件，<br />到读懂每一次体验。</h1>
        <p>这里说明如何使用知迹采集受限的产品信号、定位问题，并把数据留在自己掌控的环境里。</p>
        <label className="pub-docs-search"><span aria-hidden="true">⌕</span><input ref={searchRef} aria-label="搜索文档" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文档，例如“身份”或“错误”" /><kbd>⌘ K</kbd></label>
      </div>
    </section>
    <section className="pub-docs-wrap pub-docs-index-body" aria-label="文档目录">
      <div className="pub-docs-start"><span>推荐从这里开始</span><Link href="/docs/quickstart">浏览器快速开始 <b>→</b></Link></div>
      <aside className="pub-docs-open-source" aria-label="开源发布状态">
        <div><p>开放源码</p><h2>先从已发布的 Browser SDK 开始。</h2><span>当前版本 <b>@zhiji-labs/browser-sdk 0.1.1</b>；Node、React Native 与 Python SDK 均为计划中，尚未提供可安装的公开包。</span></div>
        <div className="pub-docs-open-source-links"><a href="https://github.com/cryptochain-tools/zhiji" target="_blank" rel="noreferrer">查看 GitHub <b aria-hidden="true">↗</b></a><Link href="/self-hosting">了解自部署</Link><small>平台采用 AGPL-3.0；SDK 与 Vite 插件按各目录中的 MIT License 发布。</small></div>
      </aside>
      {navigation.map(section => {
        const sectionCards = results.filter(card => card.group === section.group)
        if (!sectionCards.length) return null
        return <div className="pub-docs-collection" key={section.group}><header><p>{section.group}</p><span>{sectionCards.length.toString().padStart(2, '0')} 篇</span></header><div className="pub-docs-card-grid">{sectionCards.map(card => <Card key={card.href} className="pub-docs-card" variant="card" interactive><span className="pub-docs-card-tag">{card.tag}</span><h2>{card.title}</h2><p>{card.desc}</p><Link href={card.href}>阅读文档 <b>→</b></Link></Card>)}</div></div>
      })}
      {!results.length && <div className="pub-docs-empty"><strong>没有匹配的文档</strong><p>试试“事件”“SDK”或“部署”。</p><Button variant="outline" onClick={() => setQuery('')}>清除搜索</Button></div>}
    </section>
  </div>
}

type Section = { id: string; title: string; body: ReactNode }
type ArticleData = { group: string; title: string; lead: string; reading: string; sections: Section[]; previous?: [string, string]; next?: [string, string] }

const Code = ({ children }: { children: string }) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    window.setTimeout(() => setCopyState('idle'), 2200)
  }
  const copyLabel = copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'
  const copyMessage = copyState === 'copied' ? '代码已复制。' : copyState === 'failed' ? '复制失败，请手动选择代码。' : ''
  return <div className="pub-docs-code"><Button variant="ghost" size="sm" onClick={() => void copy()} aria-label="复制代码">{copyLabel}</Button><p className={`pub-docs-copy-status${copyState === 'idle' ? ' is-idle' : ''}`} role="status" aria-live="polite">{copyMessage}</p><pre><code>{children}</code></pre></div>
}

const InlineCode = ({ children }: { children: ReactNode }) => <code className="pub-docs-inline-code">{children}</code>
const Note = ({ children }: { children: ReactNode }) => <aside className="pub-docs-note"><b>提示</b><div>{children}</div></aside>

const docs: Record<Exclude<PublicPage, 'docs'>, ArticleData> = {
  quickstart: {
    group: '开始使用', title: '快速开始', lead: '用一个事件完成最小接入。开始前，请在管理台创建项目，并只允许你实际使用的站点 Origin。', reading: '约 5 分钟', next: ['身份关联', '/docs/identity'],
    sections: [
      { id: 'before', title: '开始前准备', body: <><p>一个项目对应一组采集规则。先在管理台创建项目，添加精确 Origin，例如 <InlineCode>https://app.example.com</InlineCode>。不要填写通配符、路径或带参数的网址。</p><p>随后创建浏览器 Key。它是公开的写入标识，适合放在前端；它不能读取管理数据，也不能替代登录凭据。</p></> },
      { id: 'initialize', title: '初始化浏览器 SDK', body: <><p>安装公开的 Browser SDK，导入后传入 Key 和 release；默认会向当前站点的 <InlineCode>/api/ingest/*</InlineCode> 提交数据。</p><Code>{`import { init } from '@zhiji-labs/browser-sdk'

const zhiji = init({
  key: 'zj_pk_your_project_key',
  release: '2026.09.12',
})`}</Code></> },
      { id: 'track', title: '发送第一条事件', body: <><p>事件名使用稳定、可读的动作，例如用户打开价格页。属性只包含已在项目规则中允许的低敏感字段。</p><Code>{`zhiji.track('pricing_viewed', {
  plan: 'pro',
})`}</Code><Note>事件进入后，在管理台按项目、时间范围和事件名确认计数。排障时不要把完整 payload、Cookie 或业务用户资料发到工单里。</Note></> },
      { id: 'next', title: '接下来做什么', body: <div className="pub-docs-checklist"><div><i>01</i><span><b>关联身份</b>在你的业务登录完成后，再绑定业务用户。</span></div><div><i>02</i><span><b>配置采集边界</b>决定页面键、属性和可选体验采集。</span></div><div><i>03</i><span><b>验证数据</b>从一个事件开始，逐步扩展到错误与性能。</span></div></div> },
    ],
  },
  'browser-sdk': {
    group: 'SDK', title: '浏览器 SDK', lead: '浏览器 SDK 将事件、错误、行为、回放和性能拆成独立队列；每一类能力都由项目策略和客户端选项共同决定。', reading: '约 8 分钟', previous: ['快速开始', '/docs/quickstart'], next: ['采集协议', '/docs/ingestion'],
    sections: [
      { id: 'setup', title: '配置客户端', body: <><p>至少提供浏览器 Key。<InlineCode>release</InlineCode> 建议与当前前端发布版本保持一致，方便把异常和变更对应起来。</p><Code>{`import { init } from '@zhiji-labs/browser-sdk'

const zhiji = init({
  key: 'zj_pk_your_project_key',
  release: '2026.09.12',
  capturePageViews: true,
})`}</Code></> },
      { id: 'events', title: '事件与错误', body: <><p><InlineCode>track</InlineCode> 发送产品事件，<InlineCode>captureException</InlineCode> 发送已经处理过的异常。SDK 会净化页面键和属性；服务端再按项目规则进行校验。</p><Code>{`zhiji.track('checkout_started', { plan: 'pro' })

try {
  await submitOrder()
} catch (error) {
  zhiji.captureException(error)
}`}</Code></> },
      { id: 'optional', title: '按策略开启体验采集', body: <><p>行为、回放和性能不是初始化后的默认动作。它们只有在项目策略允许且客户端显式打开时才运行。回放记录的是经过净化的交互时间线，不会录制完整 DOM 或输入值。</p><Code>{`const zhiji = init({
  key: 'zj_pk_your_project_key',
  performance: true,
  replayCapture: { enabled: true, sampleRate: 0.1 },
})`}</Code><Note>客户端选项只能收紧服务端策略，不能绕过项目的页面、采样或隐私限制。</Note></> },
      { id: 'identity', title: '登录与退出', body: <p>业务登录成功后，由你的服务端签发短期 identity assertion，再调用 <InlineCode>login</InlineCode>。SDK 不会自行声称任意业务用户。退出时调用 <InlineCode>logout()</InlineCode>，它只清除当前业务用户关联，匿名 visitor 保持稳定。</p> },
    ],
  },
  'server-sdk': {
    group: 'SDK', title: 'Node SDK', lead: 'Node SDK 正在准备公开发布。当前没有可安装的公开包，也不应按照旧示例接入。', reading: '状态说明', previous: ['浏览器 SDK', '/docs/sdk/browser'], next: ['移动端 SDK', '/docs/sdk/mobile'],
    sections: [
      { id: 'status', title: '计划中', body: <><p>Node SDK 的包名、安装方式和稳定 API 仍未公开发布。请不要尝试安装 <InlineCode>@zhiji/node</InlineCode>，也不要把 server Key 放入浏览器代码。</p><Note>需要服务端采集时，请先按采集协议直接对接受控服务端入口；公开 SDK 发布后，会在变更记录中给出版本与迁移说明。</Note></> },
    ],
  },
  'mobile-sdk': {
    group: 'SDK', title: '移动端 SDK', lead: 'React Native SDK 正在准备公开发布。当前没有可安装的公开包，也不提供生产接入代码。', reading: '状态说明', previous: ['Node SDK', '/docs/sdk/server'], next: ['隐私与页面键', '/docs/privacy'],
    sections: [
      { id: 'status', title: '计划中', body: <><p>React Native 与 Python SDK 的公开包均尚未发布。请不要尝试安装 <InlineCode>@zhiji/react-native</InlineCode>，也不要根据旧示例配置移动端 Key。</p><Note>移动端 SDK 发布时会明确支持的平台、持久化边界与版本要求；在此之前，请不要把未稳定的遥测实现用于生产环境。</Note></> },
    ],
  },
  ingestion: {
    group: '开始使用', title: '采集协议', lead: '不同类型的数据走不同的入口与队列。分开投递能让重试、限流和数据边界保持清楚。', reading: '约 6 分钟', previous: ['身份关联', '/docs/identity'], next: ['浏览器 SDK', '/docs/sdk/browser'],
    sections: [
      { id: 'lanes', title: '五条采集通道', body: <div className="pub-docs-lanes"><div><b>analytics</b><InlineCode>POST /api/ingest/events</InlineCode><span>产品事件与已验证登录</span></div><div><b>error</b><InlineCode>POST /api/ingest/errors</InlineCode><span>受限错误摘要</span></div><div><b>behavior</b><InlineCode>POST /api/ingest/behavior</InlineCode><span>坐标与可信元素标识</span></div><div><b>replay</b><InlineCode>POST /api/ingest/replays</InlineCode><span>净化后的交互时间线</span></div><div><b>performance</b><InlineCode>POST /api/ingest/performance</InlineCode><span>最终 Web Vitals</span></div></div> },
      { id: 'retries', title: '重试如何工作', body: <div className="pub-docs-table"><div><b>响应</b><b>建议处理</b></div><div><InlineCode>400</InlineCode><span>检查请求结构，不重试。</span></div><div><InlineCode>401 / 403</InlineCode><span>检查 Key、Origin 与项目状态。</span></div><div><InlineCode>413</InlineCode><span>缩小批次或减少内容。</span></div><div><InlineCode>429</InlineCode><span>遵从 Retry-After。</span></div><div><InlineCode>408 / 5xx</InlineCode><span>仅在对应通道中有限重试。</span></div></div> },
      { id: 'idempotency', title: '幂等与顺序', body: <p>同一通道内的 <InlineCode>client_event_id</InlineCode> 用于去重；不要将错误或回放投递到 analytics 入口。跨通道没有全局的事件顺序保证。</p> },
    ],
  },
  identity: {
    group: '开始使用', title: '身份关联', lead: '匿名访问和业务登录是两件事。知迹保留匿名 visitor 的连续性，再在有依据时关联业务用户。', reading: '约 5 分钟', previous: ['快速开始', '/docs/quickstart'], next: ['采集协议', '/docs/ingestion'],
    sections: [
      { id: 'flow', title: '关联流程', body: <div className="pub-docs-flow"><span>业务登录完成</span><i>→</i><span>服务端签发 assertion</span><i>→</i><span>SDK 调用 login</span><i>→</i><span>知迹验证并消费</span></div> },
      { id: 'login', title: '在登录成功后调用', body: <><p>assertion 需要由你的服务端签发，并绑定 visitor、业务用户与项目。SDK 只负责转交；它不能自行伪造用户身份。</p><Code>{`const assertion = await appApi.issueZhijiIdentityAssertion()

await zhiji.login('user_1024', assertion, {
  plan: 'pro',
})

zhiji.logout()`}</Code></> },
      { id: 'meaning', title: '关联意味着什么', body: <p>一个 visitor 可以先后关联多个业务用户。原始事件、错误与用量仍按事实去重；只有分析视图会按照事实与关联后的用户关系进行统计。</p> },
      { id: 'directory', title: '同步业务用户资料', body: <><p>需要按邮箱查找或展示业务用户时，只能由可信服务端使用 Server Key 调用资料目录接口。邮箱、姓名、部门和角色保存在独立目录中，不进入事件 properties 或浏览器 traits。</p><Code>{`curl -X POST 'https://zhiji.example.com/api/ingest/server/identities' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Zhiji-Key: zj_ser_your_server_key' \\
  -d '{
    "key": "zj_ser_your_server_key",
    "profiles": [{
      "business_user_id": "user_1024",
      "email": "user@example.com",
      "display_name": "示例用户",
      "is_active": true,
      "updated_at": "2026-09-13T08:00:00Z"
    }]
  }'`}</Code><Note>接口按项目隔离，每批最多 100 条；过期的 <InlineCode>updated_at</InlineCode> 更新不会覆盖较新的资料。</Note></> },
    ],
  },
  privacy: {
    group: '部署与参考', title: '隐私与页面键', lead: '知迹从稳定的页面标识开始采集。未知页面、敏感内容和自由文本不会因为“方便”而被回退记录。', reading: '约 6 分钟', previous: ['移动端 SDK', '/docs/sdk/mobile'], next: ['部署与运维', '/docs/operations'],
    sections: [
      { id: 'page-key', title: '使用稳定页面键', body: <><p>使用路径模板或明确的 page key，例如 <InlineCode>/orders/:orderId</InlineCode>。不要发送完整 URL、query 或 hash，它们常常包含不该出现在分析系统中的参数。</p><Code>{`zhiji.track('order_viewed', {
  page_key: '/orders/:orderId',
  source: 'notification',
})`}</Code></> },
      { id: 'excluded', title: '默认不采集的内容', body: <ul><li>Cookie、token、Authorization 和密码</li><li>表单值、完整 DOM、请求或响应正文</li><li>完整 URL query/hash、剪贴板和跨域 iframe 内容</li><li>姓名、邮箱、订单号等自由文本标识</li></ul> },
      { id: 'policy', title: '把策略当作边界', body: <p>页面 allowlist、属性规则、遮罩和采样率由项目策略决定。客户端可以进一步收紧，却不能扩大这些边界。启用行为、回放或性能前，请与负责隐私和产品的同事一起复核。</p> },
    ],
  },
  operations: {
    group: '部署与参考', title: '部署与运维', lead: '自部署需要把 Web、Worker、数据库、工件存储和恢复流程作为一个整体来准备。', reading: '约 9 分钟', previous: ['隐私与页面键', '/docs/privacy'], next: ['变更记录', '/docs/changelog'],
    sections: [
      { id: 'architecture', title: '运行组成', body: <div className="pub-docs-operation-grid"><Card variant="card"><b>Web API</b><p>处理管理台、项目配置和采集请求。</p></Card><Card variant="card"><b>Worker</b><p>处理 outbox、保留、导出、通知和数据处置。</p></Card><Card variant="card"><b>PostgreSQL</b><p>保存受限事实和事务状态，单独管理访问权限。</p></Card><Card variant="card"><b>私有工件存储</b><p>保存构建工件、导出和受控回放数据。</p></Card></div> },
      { id: 'checklist', title: '上线前检查', body: <div className="pub-docs-checklist"><div><i>01</i><span><b>隔离环境</b>准备独立数据库、环境文件与最小权限账号。</span></div><div><i>02</i><span><b>配置 HTTPS</b>确认反向代理、Origin 与外发出口。</span></div><div><i>03</i><span><b>验证恢复</b>在变更前验证备份、迁移窗口和 readiness。</span></div></div> },
      { id: 'upgrade', title: '升级与恢复', body: <p>升级前记录备份与回滚窗口，并使用受控迁移账号运行既有 migration。恢复时先恢复数据和工件，再验证 Worker、服务状态和 readiness；每一步都应留下可追溯的记录。</p> },
      { id: 'public-install', title: '公开安装与 Release', body: <p>安装步骤以公开仓库中的 <a href="https://github.com/cryptochain-tools/zhiji/blob/main/deploy/README.md" target="_blank" rel="noreferrer">安装文档</a> 与 <a href="https://github.com/cryptochain-tools/zhiji/releases" target="_blank" rel="noreferrer">Release</a> 为准。生产部署请固定 Release 或提交，并在升级前完成备份与恢复验证。</p> },
    ],
  },
  changelog: {
    group: '部署与参考', title: '变更记录', lead: '每一次影响接入方式或数据语义的变化，都会在这里说明兼容性与迁移建议。', reading: '约 2 分钟', previous: ['部署与运维', '/docs/operations'],
    sections: [
      { id: 'latest', title: '2026-09-12 · Browser SDK 0.1.1', body: <div className="pub-docs-release"><span>0.1.1</span><div><b>发布 @zhiji-labs/browser-sdk</b><p>提供受限的浏览器事件、错误、行为、回放和性能采集能力；Node、React Native 与 Python SDK 仍为计划中。</p></div></div> },
      { id: 'compatibility', title: '兼容原则', body: <p>同一主版本中，只新增可选字段或修复不改变既有行为的问题。必填字段、通道语义或身份规则发生变化时，会创建新主版本并提供迁移说明。</p> },
      { id: 'status', title: '当前状态', body: <Note>当前文档描述正在使用的接口形状与 SDK 能力。新的公开发布会在这里列出版本、变更范围与适用的迁移步骤。</Note> },
    ],
  },
}

function Article({ page, Link }: { page: Exclude<PublicPage, 'docs'>; Link: ComponentType<LinkProps> }) {
  const doc = docs[page] ?? docs.quickstart
  const [menuOpen, setMenuOpen] = useState(false)
  const mobileNavRef = useRef<HTMLDivElement>(null)
  const mobileMenuToggleRef = useRef<HTMLButtonElement>(null)
  const active = page
  const closeMobileMenu = (restoreFocus = false) => {
    setMenuOpen(false)
    if (restoreFocus) window.setTimeout(() => mobileMenuToggleRef.current?.focus(), 0)
  }
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMobileMenu(true)
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!mobileNavRef.current?.contains(event.target as Node)) closeMobileMenu(true)
    }
    addEventListener('keydown', onKeyDown)
    addEventListener('pointerdown', onPointerDown)
    return () => {
      removeEventListener('keydown', onKeyDown)
      removeEventListener('pointerdown', onPointerDown)
    }
  }, [menuOpen])
  return <div className="pub-docs pub-docs-article">
    <div className="pub-docs-mobile-nav" ref={mobileNavRef}><Button ref={mobileMenuToggleRef} variant="outline" size="sm" aria-expanded={menuOpen} aria-controls="docs-mobile-navigation" onClick={() => setMenuOpen(value => !value)}>文档目录 <span aria-hidden="true">⌄</span></Button>{menuOpen && <SideNav id="docs-mobile-navigation" active={active} Link={Link} onNavigate={() => closeMobileMenu()} />}</div>
    <div className="pub-docs-layout pub-docs-wrap">
      <aside className="pub-docs-side"><Link className="pub-docs-side-home" href="/docs"><i>↖</i> 全部文档</Link><SideNav active={active} Link={Link} /></aside>
      <article className="pub-docs-content">
        <div className="pub-docs-breadcrumb"><Link href="/docs">文档</Link><span>/</span><span>{doc.group}</span></div>
        <div className="pub-docs-article-heading"><p>{doc.group}</p><h1>{doc.title}</h1><div><span>{doc.reading}</span><span>更新于 2026-09-12</span></div></div>
        <p className="pub-docs-lead">{doc.lead}</p>
        <div className="pub-docs-article-body">{doc.sections.map(section => <section id={section.id} key={section.id}><h2>{section.title}</h2>{section.body}</section>)}</div>
        <div className="pub-docs-pager">{doc.previous ? <Link href={doc.previous[1]}><small>← 上一篇</small><b>{doc.previous[0]}</b></Link> : <span />}{doc.next ? <Link href={doc.next[1]}><small>下一篇 →</small><b>{doc.next[0]}</b></Link> : <span />}</div>
      </article>
      <aside className="pub-docs-toc"><p>本页内容</p>{doc.sections.map(section => <a href={`#${section.id}`} key={section.id}>{section.title}</a>)}</aside>
    </div>
  </div>
}

function SideNav({ active, Link, id, onNavigate }: { active: string; Link: ComponentType<LinkProps>; id?: string; onNavigate?: () => void }) {
  return <nav id={id} className="pub-docs-side-nav" aria-label="文档导航">{navigation.map(section => <div key={section.group}><p>{section.group}</p>{section.items.map(([label, href, itemId]) => <Link className={itemId === active ? 'active' : ''} href={href} key={href} onClick={onNavigate}>{label}</Link>)}</div>)}</nav>
}
