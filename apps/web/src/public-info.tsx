import type { ComponentType, ReactNode } from 'react'
import { Badge } from '@zhiji/design/badge'
import { Button } from '@zhiji/design/button'
import { Card } from '@zhiji/design/card'
import './public-info.css'

type InfoPage = 'self-hosting' | 'security' | 'pricing'
type LinkProps = { href: string; children: ReactNode; className?: string }

export function InfoPages({ page, Link }: { page: InfoPage | string; Link: ComponentType<LinkProps> }) {
  if (page === 'self-hosting') return <SelfHosting Link={Link} />
  if (page === 'security') return <Security Link={Link} />
  return <Pricing Link={Link} />
}

function PageHero({ overline, title, lead, children }: { overline: string; title: ReactNode; lead: string; children?: ReactNode }) {
  return <section className="pub-info__hero">
    <div className="wrap pub-info__hero-inner">
      <p className="pub-info__overline"><i />{overline}</p>
      <h1>{title}</h1>
      <p className="pub-info__lead">{lead}</p>
      {children}
    </div>
  </section>
}

function SelfHosting({ Link }: { Link: ComponentType<LinkProps> }) {
  return <div className="pub-info pub-info--hosting">
    <PageHero overline="自部署" title={<>数据留在你的<br /><em>运行环境里。</em></>} lead="知迹可部署在你管理的服务器上。应用、数据库和用于处理后台任务的 Worker 各自运行，数据怎样保存、备份和访问，由你决定。">
      <div className="pub-info__actions">
        <Button asChild nativeButton={false} size="lg"><a href="https://github.com/cryptochain-tools/zhiji/blob/main/deploy/README.md" target="_blank" rel="noreferrer">阅读安装文档 <span aria-hidden="true">↗</span></a></Button>
        <Button asChild nativeButton={false} variant="outline" size="lg"><a href="https://github.com/cryptochain-tools/zhiji/releases" target="_blank" rel="noreferrer">查看 Release <span aria-hidden="true">↗</span></a></Button>
      </div>
    </PageHero>
    <section className="wrap pub-info__hosting-stage" aria-label="知迹自部署结构示意">
      <div className="pub-info__stage-note"><i />应用服务与数据存储由你管理</div>
      <div className="pub-info__topology">
        <div className="pub-info__topology-node pub-info__topology-node--visitors"><span>01</span><b>网站与 Web 应用</b><small>按你的采集规则发送信号</small></div>
        <div className="pub-info__topology-line pub-info__topology-line--one" aria-hidden="true"><i /><i /><i /></div>
        <div className="pub-info__topology-node pub-info__topology-node--app"><span>02</span><b>知迹应用</b><small>管理台与受控 API</small></div>
        <div className="pub-info__topology-line pub-info__topology-line--two" aria-hidden="true"><i /><i /><i /></div>
        <div className="pub-info__topology-node pub-info__topology-node--worker"><span>03</span><b>后台 Worker</b><small>异步处理与定期任务</small></div>
        <div className="pub-info__topology-data">
          <div><span>04</span><b>PostgreSQL</b><small>应用数据与受限事实</small></div>
          <div><span>05</span><b>私有工件存储</b><small>回放、导出与构建工件</small></div>
        </div>
      </div>
    </section>
    <section className="pub-info__section pub-info__section--soft">
      <div className="wrap">
        <header className="pub-info__section-head"><p>部署之前</p><h2>把几个关键位置先准备好。</h2><span>知迹不是一键托管服务。部署完成后，运行与数据治理仍由部署团队负责。</span></header>
        <ol className="pub-info__steps">
          <li><span>01</span><h3>准备运行环境</h3><p>配置 HTTPS 反向代理，并让应用和 Worker 以独立服务持续运行。</p></li>
          <li><span>02</span><h3>连接独立数据存储</h3><p>使用独立的 PostgreSQL；需要保留工件时，准备受控的私有对象存储。</p></li>
          <li><span>03</span><h3>迁移、检查并启动</h3><p>在备份和回滚窗口确认后运行迁移，检查服务、Worker 与就绪状态。</p></li>
        </ol>
        <div className="pub-info__detail-link"><a href="https://github.com/cryptochain-tools/zhiji/blob/main/deploy/README.md" target="_blank" rel="noreferrer">查看公开安装文档 <span aria-hidden="true">↗</span></a><p>安装文档说明环境文件、迁移顺序和运行检查；生产环境请使用经过验证的固定版本。</p></div>
      </div>
    </section>
    <section className="wrap pub-info__responsibility">
      <div><p className="pub-info__overline"><i />清楚的责任边界</p><h2>知迹提供软件，<br />你掌握运行方式。</h2></div>
      <div className="pub-info__responsibility-cards">
        <Card className="pub-info__responsibility-card" variant="card"><Badge variant="outline">知迹软件</Badge><h3>产品内部的边界</h3><p>项目级采集策略、管理会话、采集 Key、受控访问与后台处理在产品中各自分开。</p></Card>
        <Card className="pub-info__responsibility-card" variant="card"><Badge variant="outline">部署团队</Badge><h3>你来决定的事项</h3><p>域名和 HTTPS、数据位置、访问控制、备份恢复、外发通道，以及采集和保留策略。</p></Card>
      </div>
    </section>
    <section className="pub-info__closing"><div className="wrap"><div><p>从一条事件开始</p><h2>让数据留在你熟悉的地方。</h2></div><Button asChild nativeButton={false} size="lg"><Link href="/docs/operations">开始部署 <span aria-hidden="true">→</span></Link></Button></div></section>
  </div>
}

function Security({ Link }: { Link: ComponentType<LinkProps> }) {
  return <div className="pub-info pub-info--security">
    <PageHero overline="安全与隐私" title={<>只观察需要的，<br /><em>把边界说清楚。</em></>} lead="知迹用于帮助团队理解产品使用和问题。采集范围由项目策略决定；回放按需开启，部署团队可以控制哪些页面和信号进入系统。">
      <div className="pub-info__actions"><Button asChild nativeButton={false} size="lg"><Link href="/docs/privacy">查看采集边界 <span aria-hidden="true">→</span></Link></Button><Button asChild nativeButton={false} variant="outline" size="lg"><Link href="/self-hosting">了解自部署</Link></Button></div>
    </PageHero>
    <section className="wrap pub-info__boundary">
      <header><p className="pub-info__overline"><i />采集边界</p><h2>先由你决定，<br />再开始记录。</h2><p>接入前，团队可以为每个项目限定允许采集的页面、事件和属性。这样数据从一开始就有清晰范围。</p></header>
      <div className="pub-info__boundary-board" aria-label="采集边界示意">
        <div className="pub-info__boundary-row"><span className="pub-info__check">✓</span><div><b>允许的产品信号</b><small>受控事件名、有限属性、稳定页面键、最终性能指标</small></div><em>按项目设置</em></div>
        <div className="pub-info__boundary-row"><span className="pub-info__check">✓</span><div><b>按需开启的交互线索</b><small>允许页面内的路由、尺寸、滚动和可信交互时间线</small></div><em>默认关闭</em></div>
        <div className="pub-info__boundary-row pub-info__boundary-row--blocked"><span className="pub-info__block">—</span><div><b>不会作为常规采集内容</b><small>密码、Cookie、Authorization、表单值、网络正文、完整 DOM 和媒体内容</small></div><em>排除</em></div>
      </div>
    </section>
    <section className="pub-info__section pub-info__section--ink">
      <div className="wrap pub-info__access">
        <div><p className="pub-info__overline"><i />访问分层</p><h2>写入、管理、<br />运行各有自己的门。</h2></div>
        <div className="pub-info__access-lanes">
          <article><span>01</span><h3>采集写入</h3><p>浏览器采集 Key 只用于写入受限数据，不能替代管理账户。</p></article>
          <article><span>02</span><h3>管理访问</h3><p>管理会话用于查看和配置当前租户与项目，不放入公开页面或采集内容。</p></article>
          <article><span>03</span><h3>运行凭据</h3><p>数据库、存储和外发通道的凭据由部署环境保管，不进入 SDK payload。</p></article>
        </div>
      </div>
    </section>
    <section className="wrap pub-info__security-grid">
      <div><p className="pub-info__overline"><i />部署团队仍需完成</p><h2>工具不能替你决定<br />数据如何被使用。</h2></div>
      <div className="pub-info__security-list"><p><b>明确采集目的</b><span>只记录真正用来改进产品的信号，并向用户说明。</span></p><p><b>配置项目规则</b><span>设置允许 Origin、页面、事件属性、遮罩和保留期。</span></p><p><b>管理运行环境</b><span>保护服务器、备份、私有存储和外部通知通道。</span></p></div>
    </section>
    <section className="pub-info__closing"><div className="wrap"><div><p>边界是产品的一部分</p><h2>了解完整的隐私说明。</h2></div><Button asChild nativeButton={false} size="lg"><Link href="/docs/privacy">前往隐私文档 <span aria-hidden="true">→</span></Link></Button></div></section>
  </div>
}

function Pricing({ Link }: { Link: ComponentType<LinkProps> }) {
  return <div className="pub-info pub-info--pricing">
    <PageHero overline="价格" title={<>先把成本和边界，<br /><em>说在前面。</em></>} lead="知迹平台以 AGPL-3.0 发布，软件可自行部署；服务器、存储、带宽和运维仍由部署团队承担。当前没有商业套餐、付款入口或 SLA 承诺。">
      <div className="pub-info__actions"><Button asChild nativeButton={false} size="lg"><Link href="/self-hosting">查看自部署方式 <span aria-hidden="true">→</span></Link></Button><Button asChild nativeButton={false} variant="outline" size="lg"><Link href="/docs/operations">阅读运维文档</Link></Button></div>
    </PageHero>
    <section className="wrap pub-info__pricing-facts">
      <Card className="pub-info__price-card" variant="card"><span className="pub-info__fact-number">—</span><p>公开商业价格</p><h2>尚未发布</h2><small>没有公开套餐、计费规则、币种税费或付款流程。</small></Card>
      <Card className="pub-info__price-card" variant="card"><span className="pub-info__fact-number">AGPL</span><p>平台许可证</p><h2>AGPL-3.0</h2><small>Web、API、Worker 与平台源码以 AGPL-3.0 发布；对外提供修改后的网络服务时，应依照该许可证提供相应源码。</small></Card>
      <Card className="pub-info__price-card" variant="card"><span className="pub-info__fact-number">—</span><p>服务等级</p><h2>尚未承诺</h2><small>没有公开 SLA、可用性、响应时间、数据所在地或认证资质承诺。</small></Card>
    </section>
    <section className="pub-info__section pub-info__section--soft">
      <div className="wrap pub-info__costs">
        <header className="pub-info__section-head"><p>自部署成本</p><h2>软件之外，运行环境也需要预算。</h2><span>费用取决于使用量、保存时间和所选服务商。这里列出常见构成，不是报价。</span></header>
        <div className="pub-info__cost-grid"><article><span>01</span><h3>计算与网络</h3><p>运行 Web、Worker 和 HTTPS 代理的服务器资源，以及网络流量。</p></article><article><span>02</span><h3>数据库与存储</h3><p>PostgreSQL、私有工件存储，以及备份与恢复演练所需的空间。</p></article><article><span>03</span><h3>运维时间</h3><p>升级、监控、故障处理、权限管理、备份验证和采集策略维护。</p></article></div>
      </div>
    </section>
    <section className="wrap pub-info__price-plain">
      <p className="pub-info__overline"><i />当前可以确认的</p><h2>软件免费，运行环境需要自己负责。</h2><div><p>AGPL-3.0 覆盖平台软件；Browser SDK 与后续 SDK、插件会以各自声明的宽松许可证发布。你仍需要为服务器、数据库、对象存储、带宽、备份和日常运维付费。仓库公开前，请以本页和正式 Release 的声明为准。</p><a href="https://github.com/cryptochain-tools/zhiji/blob/main/LICENSE" target="_blank" rel="noreferrer">查看 AGPL-3.0 许可证 <span aria-hidden="true">↗</span></a></div>
    </section>
    <section className="pub-info__closing"><div className="wrap"><div><p>从实际需求出发</p><h2>看看知迹是否适合你。</h2></div><Button asChild nativeButton={false} size="lg"><Link href="/product">浏览产品能力 <span aria-hidden="true">→</span></Link></Button></div></section>
  </div>
}
