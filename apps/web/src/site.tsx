import { Brand } from './brand'
import { useEffect, useState, type ComponentPropsWithRef, type MouseEvent } from 'react'
import { Button } from '@zhiji/design/button'
import { Home } from './home'
import { ProductPages } from './public-products'
import { DocsPages } from './public-docs'
import { InfoPages } from './public-info'

import { resolvePublicPath, type PageId } from './public-routes'
export { resolvePublicPath } from './public-routes'

const titles: Record<PageId, string> = {
  home: '看清用户行为，及时发现问题', product: '产品能力', errors: '错误监控', analytics: '用户分析', replay: '行为与会话回放', performance: '性能观测', pricing: '价格与用量', 'self-hosting': '自部署', security: '安全与隐私', docs: '文档中心', quickstart: '快速开始', 'browser-sdk': 'Browser SDK', 'server-sdk': 'Node SDK', 'mobile-sdk': 'React Native SDK', ingestion: '采集接口', identity: '身份关联', privacy: '隐私与页面键', operations: '部署与运维', changelog: '变更记录', 'not-found': '页面未找到',
}
function currentPath() { return location.pathname.replace(/\/+$/, '') || '/' }


function Link({ href, children, onClick, ...props }: ComponentPropsWithRef<'a'> & { href: string }) {
  return <a {...props} href={href} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target || props.download !== undefined || !href.startsWith('/') || href.startsWith('//') || href === '/console' || href.startsWith('/console/')) return
    event.preventDefault()
    history.pushState({}, '', href)
    window.scrollTo(0, 0)
    dispatchEvent(new PopStateEvent('popstate'))
  }}>{children}</a>
}
const navigation = [['产品', '/product'], ['文档', '/docs'], ['自部署', '/self-hosting'], ['安全与隐私', '/security']] as const
function Header({ path }: { path: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [path])
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); document.getElementById('public-menu-toggle')?.focus() } }
    document.body.style.overflow = 'hidden'
    document.getElementById('public-menu-close')?.focus()
    addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = previousOverflow; removeEventListener('keydown', onKey) }
  }, [open])
  return <header className="public-header"><div className="wrap public-header-inner">
    <Link className="brand-link" href="/" aria-label="知迹首页"><Brand /></Link>
    <Button id="public-menu-toggle" className="public-menu" variant="ghost" aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen(true)}>菜单 <span aria-hidden="true">☰</span></Button>
    <button className={`public-menu-backdrop${open ? ' is-open' : ''}`} type="button" aria-label="关闭主导航" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} />
    <nav id="site-nav" className={open ? 'is-open' : ''} aria-label="主导航">
      <div className="public-drawer-head"><Brand /><button id="public-menu-close" type="button" onClick={() => { setOpen(false); document.getElementById('public-menu-toggle')?.focus() }}>关闭 <span aria-hidden="true">×</span></button></div>
      {navigation.map(([label, href]) => <Link key={href} href={href} aria-current={path === href || path.startsWith(href + '/') ? 'page' : undefined}>{label}</Link>)}
      <a className="public-login" href="/console">登录管理台 <span aria-hidden="true">↗</span></a>
    </nav>
  </div></header>
}
const footerGroups = [
  { title:'了解知迹', links:[['产品概览','/product'],['用户分析','/product/analytics'],['错误监控','/product/errors'],['性能观测','/product/performance'],['行为与回放','/product/replay']] },
  { title:'开始使用', links:[['文档中心','/docs'],['快速开始','/docs/quickstart'],['Browser SDK','/docs/sdk/browser'],['Node SDK','/docs/sdk/server'],['React Native SDK','/docs/sdk/mobile']] },
  { title:'部署与信任', links:[['自部署','/self-hosting'],['安全与隐私','/security'],['部署与运维','/docs/operations'],['价格与用量','/pricing'],['变更记录','/docs/changelog']] },
]
function Footer() { return <footer className="public-footer"><div className="wrap public-footer-grid"><div><Link className="brand-link" href="/"><Brand /></Link><p>了解用户，发现问题。<br />把每一次改进，做得更有依据。</p><span className="public-footer-note">产品分析 · 错误监控 · 自部署</span></div>{footerGroups.map(group => <div key={group.title}><h2>{group.title}</h2>{group.links.map(([title,href]) => <Link key={href} href={href}>{title}</Link>)}</div>)}</div><div className="wrap public-footer-bottom"><span>知迹 · 为认真打磨产品的团队而做</span><div><a href="https://github.com/cryptochain-tools/zhiji" target="_blank" rel="noreferrer">GitHub</a><a href="https://github.com/cryptochain-tools/zhiji/blob/main/LICENSE" target="_blank" rel="noreferrer">AGPL-3.0</a><a href="https://github.com/cryptochain-tools/zhiji/blob/main/CONTRIBUTING.md" target="_blank" rel="noreferrer">贡献指南</a><a href="https://github.com/cryptochain-tools/zhiji/security/policy" target="_blank" rel="noreferrer">安全报告</a></div></div></footer> }

export function Site() {
  const [path, setPath] = useState(currentPath)
  const page = resolvePublicPath(path)
  useEffect(() => { const handler = () => setPath(currentPath()); addEventListener('popstate', handler); return () => removeEventListener('popstate', handler) }, [])
  useEffect(() => { document.title = `${titles[page]} · 知迹` }, [page])
  useEffect(() => {
    if (page === 'home' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animations: Animation[] = []
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        animations.push(entry.target.animate([{ opacity: 0, transform: 'translateY(22px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 650, easing: 'cubic-bezier(.2,.7,.2,1)' }))
        observer.unobserve(entry.target)
      }
    }, { threshold: 0.08 })
    document.querySelectorAll('.pub-products section, .pub-info section, .pub-docs-collection').forEach(element => observer.observe(element))
    return () => { observer.disconnect(); animations.forEach(animation => animation.cancel()) }
  }, [page])
  let content
  if (page === 'home') content = <Home Link={Link} />
  else if (page === 'product' || page === 'errors' || page === 'analytics' || page === 'replay' || page === 'performance') content = <ProductPages page={page} Link={Link} />
  else if (page === 'self-hosting' || page === 'security' || page === 'pricing') content = <InfoPages page={page} Link={Link} />
  else if (page !== 'not-found') content = <DocsPages page={page} Link={Link} />
  else content = <section className="public-not-found wrap"><small>404 / 页面未找到</small><h1>这条路径，暂时没有内容。</h1><p>可以回到首页，或从文档中心找到需要的信息。</p><div><Button asChild nativeButton={false}><Link href="/">返回首页 →</Link></Button><Link href="/docs">浏览文档</Link></div></section>
  return <div className="site-root"><a className="skip" href="#main">跳至正文</a><Header path={path}/><main id="main" key={page}>{content}</main><Footer/></div>
}
