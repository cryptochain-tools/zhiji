import assert from 'node:assert/strict'
import test from 'node:test'
import { replayFrameState, replayPlayerDocument, replayTree } from '../src/replay-player'

test('replay player retains only the closed structural AST', () => {
  assert.deepEqual(replayTree({ tag: 'main', attrs: { role: 'main' }, children: [{ tag: 'blocked', blocked: true }] }), { tag: 'main', attrs: { role: 'main' }, children: [{ tag: 'blocked', blocked: true }] })
  assert.equal(replayTree({ tag: 'a', attrs: { href: 'https://unsafe.example' } }), null)
  assert.equal(replayTree({ tag: 'div', text: 'secret' }), null)
  assert.equal(replayTree({ tag: 'script' }), null)
})

test('replay iframe only permits its fixed nonce-bound renderer and no network sources', () => {
  const document = replayPlayerDocument('fixed-test-nonce')
  assert.match(document, /default-src 'none'/)
  assert.match(document, /connect-src 'none'/)
  assert.match(document, /script-src 'nonce-fixed-test-nonce'/)
  assert.doesNotMatch(document, /innerHTML|insertAdjacentHTML|fetch\(/)
})

test('replay state only accepts bounded protocol fields through the selected event', () => {
  const state = replayFrameState([
    { t: 'checkout', route: '/orders/{id}', viewport: { width: 1440, height: 900 } },
    { t: 'scroll', x: 0, y: 480 },
    { t: 'interaction', action: 'click', x: 33, y: 44 },
    { t: 'navigation', route: 'javascript:alert(1)', viewport: { width: -1, height: 2 } },
  ], 3)
  assert.deepEqual(state, { route: '/orders/{id}', viewport: { width: 1440, height: 900 }, scroll: { x: 0, y: 480 }, interaction: { action: 'click', x: 33, y: 44 } })
})
