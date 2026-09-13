import assert from 'node:assert/strict'
import test from 'node:test'
import { resolvePublicPath } from '../src/public-routes'

test('public homepage and every documented SDK route resolve', () => {
  assert.equal(resolvePublicPath('/'), 'home')
  assert.equal(resolvePublicPath('/docs'), 'docs')
  assert.equal(resolvePublicPath('/docs/quickstart'), 'quickstart')
  assert.equal(resolvePublicPath('/docs/sdk/browser'), 'browser-sdk')
  assert.equal(resolvePublicPath('/docs/sdk/server'), 'server-sdk')
  assert.equal(resolvePublicPath('/docs/sdk/mobile'), 'mobile-sdk')
  assert.equal(resolvePublicPath('/docs/identity'), 'identity')
  assert.equal(resolvePublicPath('/docs/ingestion'), 'ingestion')
  assert.equal(resolvePublicPath('/docs/privacy'), 'privacy')
  assert.equal(resolvePublicPath('/docs/operations'), 'operations')
})

test('unknown public route has a dedicated not-found state', () => {
  assert.equal(resolvePublicPath('/docs/sdk/unknown'), 'not-found')
  assert.equal(resolvePublicPath('/console'), 'not-found')
  assert.equal(resolvePublicPath('/api/auth/me'), 'not-found')
})

test('marketing detail links and published aliases resolve independently', () => {
  for (const [path, page] of Object.entries({
    '/product': 'product', '/product/errors': 'errors',
    '/product/analytics': 'analytics', '/product/replay': 'replay',
    '/product/performance': 'performance', '/pricing': 'pricing',
    '/security': 'security', '/self-hosting': 'self-hosting',
    '/self-host': 'self-hosting', '/docs/self-hosting': 'operations',
    '/docs/changelog': 'changelog',
  })) {
    assert.equal(resolvePublicPath(path), page)
    assert.equal(resolvePublicPath(path + '/'), page)
  }
})
