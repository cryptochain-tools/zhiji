export type PageId = 'home' | 'product' | 'errors' | 'analytics' | 'replay' | 'performance' | 'pricing' | 'self-hosting' | 'security' | 'docs' | 'quickstart' | 'browser-sdk' | 'server-sdk' | 'mobile-sdk' | 'ingestion' | 'identity' | 'privacy' | 'operations' | 'changelog' | 'not-found'
const routes: Record<string, PageId> = {
  '/': 'home', '/product': 'product', '/product/errors': 'errors', '/product/analytics': 'analytics', '/product/replay': 'replay', '/product/performance': 'performance', '/pricing': 'pricing', '/self-hosting': 'self-hosting', '/self-host': 'self-hosting', '/security': 'security', '/docs': 'docs', '/docs/quickstart': 'quickstart', '/docs/sdk/browser': 'browser-sdk', '/docs/sdk/server': 'server-sdk', '/docs/sdk/mobile': 'mobile-sdk', '/docs/ingestion': 'ingestion', '/docs/identity': 'identity', '/docs/privacy': 'privacy', '/docs/self-hosting': 'operations', '/docs/operations': 'operations', '/docs/changelog': 'changelog',
}

export function resolvePublicPath(path = '/'): PageId { return routes[path.replace(/\/+$/, '') || '/'] ?? 'not-found' }
