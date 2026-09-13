import { createHash } from 'node:crypto'

/** Thrown before receipts/session metadata are written for an unsafe chunk. */
export class ReplayPayloadError extends Error {}

type TimelineEvent =
  | { t: 'checkout' | 'navigation'; at: number; route: string; viewport: { width: number; height: number } }
  | { t: 'snapshot'; at: number; tree: ReplayNode }
  | { t: 'scroll'; at: number; x: number; y: number }
  | { t: 'resize'; at: number; viewport: { width: number; height: number } }
  | { t: 'interaction'; at: number; action: 'click' | 'submit'; x: number; y: number }

type ReplayNode = { tag: string; attrs?: Record<string, string | boolean>; children?: ReplayNode[]; blocked?: true }
const STRUCTURAL_TAGS = new Set([ 'html', 'body', 'main', 'header', 'footer', 'nav', 'section', 'article', 'aside', 'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'button', 'a', 'label', 'input', 'textarea', 'select', 'option', 'form', 'fieldset', 'legend', 'details', 'summary' ])

/**
 * The current recorder emits a small closed AST rather than rrweb's arbitrary
 * event graph.  Decoding and checking it here makes the database a second
 * privacy boundary: text, form values, DOM/HTML and unknown fields cannot be
 * smuggled through a browser client that bypasses the SDK.
 */
export function validateSanitizedReplayChunk(input: { encoding: string; data: string; sha256: string }): void {
  if (input.encoding !== 'rrweb-json') throw new ReplayPayloadError('unsupported replay encoding')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.data) || input.data.length % 4 !== 0) throw new ReplayPayloadError('invalid base64')
  let raw: string
  try { raw = Buffer.from(input.data, 'base64').toString('utf8') } catch { throw new ReplayPayloadError('invalid base64') }
  if (Buffer.from(raw, 'utf8').toString('base64') !== input.data) throw new ReplayPayloadError('invalid base64')
  if (!raw || Buffer.byteLength(raw, 'utf8') > 256 * 1024) throw new ReplayPayloadError('replay chunk is too large')
  const digest = createHash('sha256').update(raw, 'utf8').digest('hex')
  if (digest !== input.sha256) throw new ReplayPayloadError('replay checksum mismatch')
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new ReplayPayloadError('invalid replay json') }
  if (!isRecord(parsed) || !sameKeys(parsed, [ 'version', 'events' ]) || parsed.version !== 1 || !Array.isArray(parsed.events) || parsed.events.length < 1 || parsed.events.length > 500) throw new ReplayPayloadError('invalid replay timeline')
  let prior = -1
  for (const event of parsed.events) {
    validateEvent(event)
    const at = (event as TimelineEvent).at
    if (at < prior) throw new ReplayPayloadError('replay timeline is out of order')
    prior = at
  }
}

function validateEvent(value: unknown): asserts value is TimelineEvent {
  if (!isRecord(value) || typeof value.t !== 'string' || !finiteNonNegative(value.at)) throw new ReplayPayloadError('invalid replay event')
  switch (value.t) {
    case 'checkout': case 'navigation':
      if (!sameKeys(value, [ 't', 'at', 'route', 'viewport' ]) || !route(value.route) || !viewport(value.viewport)) throw new ReplayPayloadError('invalid replay route event')
      return
    case 'snapshot':
      if (!sameKeys(value, [ 't', 'at', 'tree' ]) || !replayNode(value.tree, 0, { value: 0 })) throw new ReplayPayloadError('invalid replay snapshot')
      return
    case 'scroll':
      if (!sameKeys(value, [ 't', 'at', 'x', 'y' ]) || !finiteCoordinate(value.x) || !finiteCoordinate(value.y)) throw new ReplayPayloadError('invalid replay scroll event')
      return
    case 'resize':
      if (!sameKeys(value, [ 't', 'at', 'viewport' ]) || !viewport(value.viewport)) throw new ReplayPayloadError('invalid replay resize event')
      return
    case 'interaction':
      if (!sameKeys(value, [ 't', 'at', 'action', 'x', 'y' ]) || (value.action !== 'click' && value.action !== 'submit') || !finiteCoordinate(value.x) || !finiteCoordinate(value.y)) throw new ReplayPayloadError('invalid replay interaction event')
      return
    default: throw new ReplayPayloadError('unknown replay event')
  }
}

function replayNode(value: unknown, depth: number, nodes: { value: number }): value is ReplayNode {
  if (!isRecord(value) || depth > 32 || ++nodes.value > 2_000 || typeof value.tag !== 'string') return false
  if (value.tag === 'blocked') return value.blocked === true && sameKeys(value, [ 'tag', 'blocked' ])
  if (!STRUCTURAL_TAGS.has(value.tag)) return false
  const keys = Object.keys(value); if (!keys.every(key => [ 'tag', 'attrs', 'children' ].includes(key))) return false
  if (value.attrs !== undefined && !safeAttrs(value.attrs)) return false
  return value.children === undefined || Array.isArray(value.children) && value.children.every(child => replayNode(child, depth + 1, nodes))
}

function safeAttrs(value: unknown): boolean {
  if (!isRecord(value)) return false
  const keys = Object.keys(value); if (keys.length > 5 || !keys.every(key => [ 'role', 'type', 'disabled', 'checked', 'aria-hidden' ].includes(key))) return false
  return Object.entries(value).every(([ key, entry ]) => key === 'disabled' || key === 'checked' ? entry === true : key === 'aria-hidden' ? entry === 'true' || entry === 'false' : typeof entry === 'string' && /^[a-z][a-z0-9_-]{0,63}$/i.test(entry))
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype }
function sameKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value); return actual.length === keys.length && actual.every(key => keys.includes(key)) }
function finiteNonNegative(value: unknown): boolean { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 4_102_444_800_000 }
function finiteCoordinate(value: unknown): boolean { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 }
function route(value: unknown): boolean { return typeof value === 'string' && value.length >= 1 && value.length <= 512 && value.startsWith('/') && !/[?#@]/.test(value) }
function viewport(value: unknown): boolean { return isRecord(value) && sameKeys(value, [ 'width', 'height' ]) && finiteCoordinate(value.width) && finiteCoordinate(value.height) }
