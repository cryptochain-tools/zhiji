import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react'
import type * as React from 'react'
import { Badge } from '@zhiji/design/badge'
import { Button } from '@zhiji/design/button'
import { HeroParticles } from './home-particles'

type LinkProps = { href: string; children: ReactNode; className?: string }
type HomeProps = { Link: ComponentType<LinkProps> }
type Tab = 'analytics' | 'errors' | 'experience'
const tabs: { id: Tab; label: string }[] = [{ id: 'analytics', label: '用户分析' }, { id: 'errors', label: '错误监控' }, { id: 'experience', label: '体验表现' }]
const content: Record<Tab, { title: string; note: string; metrics: [string, string, string][]; insight: string; path: string }> = {
  analytics: { title: '关键路径正在变清晰', note: '把访问、激活和完成放在同一条路径里看。', metrics: [['活跃用户', '12,480', '↑ 18.4%'], ['激活率', '68.2%', '↑ 5.7%'], ['完成目标', '2,816', '↑ 12.1%']], insight: '新手引导完成率提升 12.1%', path: 'M0 128C26 122 34 103 58 108S88 120 108 92s32-27 60-9 34 29 60-9 32-27 60-13 31 21 58-18 35-13 62 0 34 25 60-12 26-14 52-8' },
  errors: { title: '优先处理真正影响用户的问题', note: '同类异常自动聚合，先看影响范围，再进入细节。', metrics: [['受影响用户', '186', '需关注'], ['新增问题', '8', '↓ 23.1%'], ['已解决', '31', '↑ 9.4%']], insight: '支付页异常已影响 68 位用户', path: 'M0 100C29 89 45 107 71 92s33-49 60-30 30 49 60 18 33-49 63-24 33 33 59 9 33-44 66-24 35 61 65 31 39-38 76-22' },
  experience: { title: '体验变化，看得见', note: '用速度和交互信号，找到影响体验的页面。', metrics: [['首屏加载', '1.8s', '↓ 0.3s'], ['布局偏移', '0.04', '稳定'], ['交互延迟', '84ms', '稳定']], insight: '移动端首屏加载较上周快了 0.3 秒', path: 'M0 110C35 114 49 84 78 91s34 10 59-14 31-27 64-17 30 31 56 11 30-32 60-17 33 32 62 11 34-34 62-20 35 34 79-17' },
}
function Chart({ type }: { type: Tab }) { const d = content[type].path; return <svg className="zhome-chart" viewBox="0 0 520 148" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id={`chart-${type}`} x1="0" x2="0" y1="0" y2="1"><stop stopColor="var(--brand)" stopOpacity=".25"/><stop offset="1" stopColor="var(--brand)" stopOpacity="0"/></linearGradient></defs>{[32,72,112].map(y => <path key={y} d={`M0 ${y}H520`} stroke="#e5eeeb" strokeDasharray="3 5"/>)}<path d={`${d}L520 148H0Z`} fill={`url(#chart-${type})`}/><path d={d} fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round"/></svg> }
function Studio() { const [active, setActive] = useState<Tab>('analytics'); const id = useId(); const item = content[active]; const moveTab = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => { const key = event.key; if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return; event.preventDefault(); const next = key === 'Home' ? 0 : key === 'End' ? tabs.length - 1 : (index + (key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; setActive(tabs[next].id); (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next])?.focus() }; return <div className="zhome-studio" aria-label="知迹产品界面示例"><header><div className="zhome-logo">迹</div><b>知迹</b><span>青岚设计 / 官网</span><Badge variant="secondary">示例数据</Badge><i>L</i></header><div className="zhome-studio-layout"><aside><b>概览</b><span>用户分析</span><span>错误监控</span><span>体验表现</span><span>设置</span></aside><section><div className="zhome-panel-top"><div><small>最近 7 天 · 产品概览</small><h3>{item.title}</h3><p>{item.note}</p></div><em>近 7 天⌄</em></div><div className="zhome-tabs" role="tablist" aria-label="产品数据视图">{tabs.map((tab, index) => <button key={tab.id} id={`${id}-${tab.id}`} role="tab" type="button" aria-selected={active === tab.id} aria-controls={`${id}-panel`} tabIndex={active === tab.id ? 0 : -1} onKeyDown={event => moveTab(event, index)} onClick={() => setActive(tab.id)}>{tab.label}</button>)}</div><div className="zhome-metrics">{item.metrics.map(([label, value, change]) => <div key={label}><small>{label}</small><strong>{value}</strong><span className={change === '需关注' ? 'warn' : ''}>{change}</span></div>)}</div><div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${active}`} className="zhome-chart-panel"><div><b>{active === 'errors' ? '问题影响趋势' : active === 'experience' ? '页面加载趋势' : '活跃用户趋势'}</b><small>按天</small></div><Chart type={active}/><footer><span>9 月 06 日</span><span>9 月 08 日</span><span>9 月 10 日</span><span>今天</span></footer></div><div className="zhome-insight"><i/><div><b>{item.insight}</b><small>示例洞察</small></div></div></section></div></div> }
function FlowArt(){return <div className="zhome-flow-ui"><header><i/><i/><i/><b>关键路径</b><span>示例数据</span></header><div className="zhome-flow-steps"><div><small>01</small><b>查看方案</b><span>8,420 人</span></div><i>→</i><div><small>02</small><b>创建项目</b><span>4,756 人</span></div><i>→</i><div className="final"><small>03</small><b>完成接入</b><span>3,962 人</span></div></div><footer><b>这里有机会做得更好</b><span>创建项目到完成接入，流失了 16.7%</span></footer></div>}
export function Home({ Link }: HomeProps) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const animations = new Set<Animation>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer.unobserve(entry.target)
        if (media.matches) continue
        const animation = entry.target.animate([
          { opacity: 0, transform: 'translateY(28px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 700, delay: Number((entry.target as HTMLElement).dataset.delay ?? 0), easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' })
        animations.add(animation)
        animation.onfinish = () => animations.delete(animation)
      }
    }, { threshold: .12 })
    root.current?.querySelectorAll('[data-reveal]').forEach(element => observer.observe(element))
    const stop = () => { if (media.matches) animations.forEach(animation => animation.cancel()) }
    media.addEventListener('change', stop)
    return () => { observer.disconnect(); animations.forEach(animation => animation.cancel()); media.removeEventListener('change', stop) }
  }, [])

  return <div className="zhome" ref={root}>
    <section className="zhome-hero">
      <HeroParticles paused={false} />
      <div className="wrap zhome-hero-inner">
        <div className="zhome-hero-copy">
          <Badge variant="outline" className="zhome-badge"><i /> 为网站和 Web 应用而做</Badge>
          <h1>看清用户行为，<br /><em>及时发现问题。</em></h1>
          <p>知迹是一款支持自部署的产品分析与错误监控工具。了解用户如何使用产品，找到转化流失、页面报错和加载缓慢的原因。</p>
          <div className="zhome-actions">
            <Button asChild nativeButton={false} size="lg"><a href="https://github.com/cryptochain-tools/zhiji" target="_blank" rel="noreferrer">GitHub 查看源码 <span aria-hidden="true">↗</span></a></Button>
            <Button asChild nativeButton={false} variant="outline" size="lg"><Link href="/self-hosting">自部署知迹 →</Link></Button>
          </div>
          <p className="zhome-open-source-note">源码、许可证与自部署资料已经公开，可直接审查或部署。</p>
          <div className="zhome-trust"><span>用户分析</span><span>错误监控</span><span>性能观测</span></div>
        </div>
        <div className="zhome-orbit-labels" aria-hidden="true">
          <span className="orbit-label orbit-one"><i /> 页面访问 <b>已记录</b></span>
          <span className="orbit-label orbit-two"><i /> 关键转化 <b>完成</b></span>
          <span className="orbit-label orbit-three"><i /> 异常信号 <b>待处理</b></span>
          <div className="orbit-caption">每一次访问，都有迹可循。<small>信号流动示意</small></div>
        </div>
      </div>
    </section>

    <section id="product-studio" className="zhome-demo wrap">
      <header className="zhome-section-head" data-reveal><div><small>01 / 一个工作台，三种视角</small><h2>有人用吗？哪里出错？<br />体验够好吗？</h2></div><p>切换下方视图，看看知迹如何回答这些问题。界面中的数字均为演示数据。</p></header>
      <div data-reveal><Studio /></div>
      <div className="zhome-demo-notes" data-reveal><p><b>了解使用情况</b>查看访问趋势、关键事件和转化路径。</p><p><b>跟进产品问题</b>聚合同类报错，了解受影响的范围。</p><p><b>观察真实体验</b>比较页面加载与交互表现的变化。</p></div>
    </section>

    <section className="zhome-feature wrap">
      <div data-reveal><small>02 / 用户分析</small><h2>找到用户<br /><em>停下来的那一步。</em></h2><p>注册的人不少，完成关键操作的人却很少？把访问、注册和使用串成一条路径，看清用户在哪一步离开，再决定从哪里改起。</p><ul><li>事件分析：哪些功能被真正使用</li><li>漏斗与路径：用户在哪里流失</li><li>留存分析：用户是否愿意再回来</li></ul><Link href="/product/analytics">了解用户分析 <span aria-hidden="true">↗</span></Link></div>
      <div className="zhome-feature-art" data-reveal data-delay="100"><img src="/images/zhiji-journey-studio.png" width="1672" height="941" alt="白色微缩建筑中连接各个节点的绿色路径" loading="lazy" /><FlowArt /></div>
    </section>

    <section className="zhome-errors">
      <div className="wrap zhome-feature">
        <div className="zhome-issue-art" data-reveal><header><span><i /> 问题中心</span><small>示例</small></header><div className="zhome-issue-row"><span className="issue-mark">!</span><div><b>结算页加载异常</b><small>首次发现 10:32 · 最近发生 2 分钟前</small></div><Badge variant="outline">待处理</Badge></div><div className="zhome-issue-stats"><div><small>受影响用户</small><strong>68</strong></div><div><small>发生次数</small><strong>142</strong></div><div><small>处理状态</small><strong className="issue-status">排查中</strong></div></div><div className="zhome-issue-trace"><span>访问商品</span><i>→</i><span>加入购物车</span><i>→</i><b>结算异常</b></div><p>把问题和影响范围放在一起，决定先处理哪一件。</p></div>
        <div data-reveal data-delay="100"><small>03 / 错误监控</small><h2>用户没说出口，<br /><em>问题已经有了线索。</em></h2><p>页面报错后，用户可能直接离开。知迹将重复异常汇成问题，帮助你查看出现频率、影响范围与版本信息，持续跟进处理进度。</p><ul><li>同类异常聚合，减少重复排查</li><li>保留关键错误线索，缩小定位范围</li><li>跟踪处理状态，让问题有始有终</li></ul><Link href="/product/errors">了解错误监控 <span aria-hidden="true">↗</span></Link></div>
      </div>
    </section>

    <section className="zhome-feature wrap">
      <div data-reveal><small>04 / 性能观测</small><h2>慢在哪里，<br /><em>用真实体验来回答。</em></h2><p>本机打开很快，不代表每位用户都一样。观察实际访问中的加载和交互指标，对比页面与版本，确认一次更新有没有让体验变好。</p><ul><li>查看页面加载与交互表现</li><li>按页面、时间和版本比较变化</li><li>区分暂无数据与真实的零值</li></ul><Link href="/product/performance">了解性能观测 <span aria-hidden="true">↗</span></Link></div>
      <figure className="zhome-performance-art" data-reveal data-delay="100"><img src="/images/zhiji-signal-studio.png" width="1672" height="941" alt="绿色数据柱与半透明面板组成的分析装置" loading="lazy" /><figcaption><span>页面加载 · 示例</span><strong>1.8 <small>秒</small></strong><b>比上一版本快 0.3 秒 ↗</b></figcaption></figure>
    </section>

    <section className="zhome-start">
      <div className="wrap"><header className="zhome-section-head" data-reveal><div><small>05 / 从第一条数据开始</small><h2>把知迹接入你的产品。</h2></div><p>适合需要了解产品使用情况、又希望自己管理数据的个人开发者和小团队。</p></header><ol className="zhome-steps">{[
        ['部署知迹', '在自己的服务器上运行知迹，创建管理账户。', '/self-hosting', '查看部署方式'],
        ['创建项目并接入', '为网站或 Web 应用创建项目，按指引接入 SDK，配置采集范围。', '/docs/quickstart', '阅读接入指南'],
        ['开始观察与改进', '收到第一条数据后，查看趋势、排查错误，再验证改动效果。', '/console', '进入管理台'],
      ].map(([title, description, href, action], index) => <li key={title} data-reveal data-delay={index * 90}><span>0{index + 1}</span><h3>{title}</h3><p>{description}</p><a href={href}>{action} ↗</a></li>)}</ol><div className="zhome-data-note" data-reveal><b>数据的边界，由你设置。</b><p>支持自部署和项目级采集策略；会话回放按需开启。接入前，先确定要观察什么、保留多久。</p><Link href="/security">了解安全与隐私 →</Link></div></div>
    </section>
    <section className="zhome-closing wrap" data-reveal><div><small>少一点猜测，多一点依据。</small><h2>下一次改进，<em>从看清产品开始。</em></h2></div><div><Button asChild nativeButton={false} size="lg"><Link href="/self-hosting">开始部署知迹 →</Link></Button><Link className="zhome-closing-secondary" href="/product">查看完整产品能力</Link></div></section>
  </div>
}
