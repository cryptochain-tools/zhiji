import type { ComponentType, ReactNode } from 'react'
import { Badge } from '@zhiji/design/badge'
import { Button } from '@zhiji/design/button'
import { Card } from '@zhiji/design/card'
import './public-products.css'

type ProductPage = 'product' | 'errors' | 'analytics' | 'replay' | 'performance'
type LinkProps = { href: string; children: ReactNode; className?: string }
type Props = { page: ProductPage; Link: ComponentType<LinkProps> }

const products = [
  { key: 'errors', number: '01', title: '错误监控', body: '从一条报错开始，找到真正影响用户的问题。', href: '/product/errors', icon: '×' },
  { key: 'analytics', number: '02', title: '产品分析', body: '看清用户怎么用、在哪停下、是否愿意回来。', href: '/product/analytics', icon: '↗' },
  { key: 'replay', number: '03', title: '行为洞察', body: '从点击、滚动和有限回放中理解当时发生了什么。', href: '/product/replay', icon: '⌁' },
  { key: 'performance', number: '04', title: '性能体验', body: '把慢加载和难操作的页面找出来，优先改善它们。', href: '/product/performance', icon: '◌' },
] as const

const copy: Record<Exclude<ProductPage, 'product'>, { kicker: string; title: ReactNode; lead: string; problem: string; moments: string[]; start: string[] }> = {
  errors: {
    kicker: '错误监控', title: <>每一次异常，<br/><em>都有来处。</em></>, lead: '把零散的前端异常归成清楚的问题。你能看见它何时开始、影响了多少人，以及它出现时用户正在哪个页面。',
    problem: '同一个问题不再分散在成百上千条日志里。按问题聚合后，先处理真正反复发生、正在影响体验的那一类。',
    moments: ['自动归并相似错误', '按版本与页面看变化', '保留有限的上下文线索'],
    start: ['在浏览器接入知迹', '让第一个错误抵达工作台', '从出现次数最多的问题开始看'],
  },
  analytics: {
    kicker: '产品分析', title: <>看清用户选择，<br/><em>找到改进方向。</em></>, lead: '把关键动作串成一条可读的路径。功能有没有被使用、用户在哪离开、改动有没有带来回访，都能在同一个视图里回答。',
    problem: '不是更多数字，而是更接近决策的信号。先选一个重要动作，再看它从被看见到完成之间发生了什么。',
    moments: ['事件趋势与关键动作', '转化路径中的流失点', '按时间观察再次访问'],
    start: ['确定一个关键动作', '发送少量清晰的事件', '邀请团队一起看第一条路径'],
  },
  replay: {
    kicker: '行为洞察', title: <>别猜用户为什么离开，<br/><em>看看当时发生了什么。</em></>, lead: '点击、滚动和按需开启的有限交互时间线，为数字补上现场。它帮助团队理解一个问题发生前后的页面体验。',
    problem: '图表告诉你“哪里”，行为线索帮助你理解“为什么”。每一段记录都以项目规则为边界，只留下理解体验所需的信息。',
    moments: ['点击与滚动的分布', '关键入口是否被看见', '按需查看有限交互时间线'],
    start: ['选择需要观察的页面', '配置页面与元素标识', '带着一个具体问题回看'],
  },
  performance: {
    kicker: '性能体验', title: <>速度不是参数，<br/><em>是每一次等待。</em></>, lead: '从真实访问中看加载与交互体验。用趋势发现变慢的时刻，回到具体页面，决定下一次该优先修哪里。',
    problem: '性能问题常常没有报错，却会让用户在完成前离开。用真实体验数据把“感觉有点慢”变成能排优先级的事情。',
    moments: ['加载与交互体验趋势', '按页面定位变化', '观察版本前后的差异'],
    start: ['开启性能采集', '选择需要关注的页面', '把一次体验改进和数据放在一起看'],
  },
}

function ProductVisual({ kind }: { kind: ProductPage }) {
  if (kind === 'errors') return <div className="pub-visual pub-errors" aria-label="错误监控示例界面"><div className="pub-window"><div className="pub-window-bar"><i/><i/><i/><b>问题中心</b><span>最近 7 天</span></div><div className="pub-error-layout"><div className="pub-error-list"><small>未处理</small><strong><i/> TypeError: 无法读取属性</strong><strong><i/> 请求未完成</strong><strong><i/> 页面加载失败</strong></div><div className="pub-error-detail"><Badge variant="outline">需要关注</Badge><h3>TypeError: 无法读取属性</h3><p>首次出现 09:12 · 影响 18 次访问</p><div className="pub-spark"><svg viewBox="0 0 320 74" role="img" aria-label="错误次数趋势"><path d="M0 58 C30 57 30 42 58 45 S88 18 118 42 S154 47 184 26 S220 55 250 29 S282 33 320 8" fill="none"/><path d="M0 58 C30 57 30 42 58 45 S88 18 118 42 S154 47 184 26 S220 55 250 29 S282 33 320 8 V74 H0Z"/></svg></div></div></div></div></div>
  if (kind === 'analytics') return <div className="pub-visual pub-analytics" aria-label="产品分析示例界面"><div className="pub-window"><div className="pub-window-bar"><i/><i/><i/><b>关键路径</b><span>本月</span></div><div className="pub-funnel"><div><b>8,420</b><small>浏览方案</small><span/></div><div><b>3,186</b><small>开始试用</small><span/></div><div><b>1,904</b><small>完成设置</small><span/></div><div><b>1,106</b><small>再次回来</small><span/></div></div><div className="pub-funnel-note"><span>完成路径的用户比上周更多</span><b>+ 12.4%</b></div></div></div>
  if (kind === 'replay') return <div className="pub-visual pub-replay" aria-label="行为洞察示例界面"><div className="pub-window"><div className="pub-window-bar"><i/><i/><i/><b>页面行为</b><span>示例页面</span></div><div className="pub-heat-page"><div className="pub-heat-nav"/><div className="pub-heat-hero"><b>重新理解<br/>你的团队</b><span>开始使用</span></div><div className="pub-heat-cards"><i/><i/><i/></div><div className="pub-heat-dot one"/><div className="pub-heat-dot two"/><div className="pub-heat-dot three"/></div></div><div className="pub-replay-caption"><span>点击集中在主要行动附近</span><b>示例</b></div></div>
  return <div className="pub-visual pub-performance" aria-label="性能体验示例界面"><div className="pub-window"><div className="pub-window-bar"><i/><i/><i/><b>页面体验</b><span>最近 28 天</span></div><div className="pub-vitals"><div><small>加载体验</small><b>1.8 <em>秒</em></b><span className="pub-good">表现稳定</span></div><div><small>交互响应</small><b>126 <em>毫秒</em></b><span className="pub-good">表现稳定</span></div><div><small>页面稳定</small><b>0.04</b><span className="pub-good">表现稳定</span></div></div><div className="pub-bars"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></div></div>
}

function SectionTitle({ kicker, children, body }: { kicker: string; children: ReactNode; body?: string }) { return <div className="pub-section-title"><p>{kicker}</p><h2>{children}</h2>{body && <span>{body}</span>}</div> }

function ProductIndex({ Link }: Pick<Props, 'Link'>) { return <div className="pub-products"><section className="pub-overview"><div className="pub-overview-copy"><Badge variant="outline">知迹产品</Badge><h1>用户做了什么，<br/><em>问题出在哪里。</em></h1><p>从一次访问到一个问题，把用户行为、产品使用和页面体验放在同一个工作台。你会更早发现，下一步也更容易决定。</p><Button asChild nativeButton={false}><Link href="/docs/quickstart">从这里开始</Link></Button></div><div className="pub-overview-art" aria-hidden="true"><img src="/images/zhiji-signal-studio.png" alt=""/><span/><i/><b/></div></section><section className="pub-product-list"><SectionTitle kicker="四个观察角度" body="每个角度都可以独立开始，也能在同一个问题里彼此印证。">让每次改进，<br/>都有依据。</SectionTitle><div className="pub-product-cards">{products.map(item => <Card className="pub-product-card" key={item.key} variant="card"><div><span>{item.number}</span><i>{item.icon}</i></div><h3>{item.title}</h3><p>{item.body}</p><Link href={item.href}>看看它能做什么 <b>→</b></Link></Card>)}</div></section><section className="pub-journey"><div className="pub-journey-image"><img src="/images/zhiji-journey-studio.png" alt="薄荷绿路径穿过白色微缩城市"/></div><div><p>从线索到行动</p><h2>把不同的信号，<br/>放回同一条路上。</h2><ol><li><b>发现</b><span>用户在哪离开，哪个页面变慢，什么问题在重复出现。</span></li><li><b>理解</b><span>通过路径、行为和有限上下文，看清问题发生的场景。</span></li><li><b>改善</b><span>把真正影响体验的事情排在前面，验证改动是否带来变化。</span></li></ol></div></section><section className="pub-closing"><p>知迹，帮团队更清楚地看见产品体验。</p><Button asChild nativeButton={false}><Link href="/docs">阅读接入文档</Link></Button></section></div> }

function DetailPage({ page, Link }: Props & { page: Exclude<ProductPage, 'product'> }) { const content = copy[page]; return <div className={`pub-products pub-detail pub-detail-${page}`}><section className="pub-detail-hero"><div><Badge variant="outline">{content.kicker}</Badge><h1>{content.title}</h1><p>{content.lead}</p><div className="pub-hero-actions"><Button asChild nativeButton={false}><Link href="/docs/quickstart">开始接入</Link></Button><Link href="/product">查看全部产品 <b>→</b></Link></div></div><ProductVisual kind={page}/></section><section className="pub-problem"><div><p>它解决什么</p><h2>{content.problem}</h2></div><div className="pub-moments">{content.moments.map((moment, index) => <Card key={moment} variant="card"><i>0{index + 1}</i><span>{moment}</span></Card>)}</div></section><section className="pub-showcase"><ProductVisual kind={page}/><div><SectionTitle kicker="示例工作台" body="上方内容为示例，用于说明你可以在页面中看到的信息。">信息不止是数字，<br/>也是下一步的线索。</SectionTitle><p className="pub-showcase-copy">{page === 'errors' ? '从一个归并后的问题出发，快速判断它是否正在扩大，再回到受影响的版本和页面。' : page === 'analytics' ? '围绕一次关键动作，了解用户从看见到完成之间的真实变化。' : page === 'replay' ? '看见点击和滚动落在哪里，让团队讨论基于当时的页面，而不是猜测。' : '把体验指标放到页面和时间里，观察每次发布之后用户实际感受到的变化。'}</p></div></section><section className="pub-start"><div><p>如何开始</p><h2>从一个问题，<br/>开始看见变化。</h2></div><ol>{content.start.map((item, index) => <li key={item}><b>0{index + 1}</b><span>{item}</span></li>)}</ol><Button asChild nativeButton={false}><Link href="/docs/quickstart">阅读快速开始</Link></Button></section><section className="pub-back"><p>知迹产品</p><h2>还有更多角度，<br/>帮助你理解体验。</h2><Link href="/product">查看所有产品 <b>→</b></Link></section></div> }

export function ProductPages({ page, Link }: Props) { return page === 'product' ? <ProductIndex Link={Link}/> : <DetailPage page={page} Link={Link}/> }
