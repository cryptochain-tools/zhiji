export type ReplayTreeNode = {
  tag: string
  attrs?: Record<string, string | boolean>
  children?: ReplayTreeNode[]
  blocked?: true
}

export type ReplayFrameState = {
  route: string | null
  viewport: { width: number; height: number } | null
  scroll: { x: number; y: number }
  interaction: { action: 'click' | 'submit'; x: number; y: number } | null
}

/**
 * Reduces the deliberately small replay protocol to the state at one timeline
 * position. It is intentionally closed over known fields: a captured route or
 * event can never become HTML, a URL, or a script in the player frame.
 */
export function replayFrameState(events: readonly unknown[], through: number): ReplayFrameState {
  const state: ReplayFrameState = { route: null, viewport: null, scroll: { x: 0, y: 0 }, interaction: null }
  for (let index = 0; index <= through && index < events.length; index += 1) {
    const event = events[index]
    if (!record(event) || typeof event.t !== 'string') continue
    if ((event.t === 'checkout' || event.t === 'navigation') && typeof event.route === 'string' && /^[a-zA-Z0-9_./{}-]{1,240}$/.test(event.route)) state.route = event.route
    if ((event.t === 'checkout' || event.t === 'navigation' || event.t === 'resize') && record(event.viewport)) {
      const width = coordinate(event.viewport.width); const height = coordinate(event.viewport.height)
      if (width !== null && height !== null) state.viewport = { width, height }
    }
    if (event.t === 'scroll') { const x = coordinate(event.x); const y = coordinate(event.y); if (x !== null && y !== null) state.scroll = { x, y } }
    if (event.t === 'interaction' && (event.action === 'click' || event.action === 'submit')) {
      const x = coordinate(event.x); const y = coordinate(event.y); if (x !== null && y !== null) state.interaction = { action: event.action, x, y }
    }
  }
  return state
}

function coordinate(value: unknown): number | null { return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : null }

const tags = new Set([ 'html', 'body', 'main', 'header', 'footer', 'nav', 'section', 'article', 'aside', 'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'button', 'a', 'label', 'input', 'textarea', 'select', 'option', 'form', 'fieldset', 'legend', 'details', 'summary' ])
const attrs = new Set([ 'role', 'type', 'disabled', 'checked', 'aria-hidden' ])

/** A second, UI-side boundary before an opaque-origin iframe receives a tree. */
export function replayTree(value: unknown, depth = 0, count = { value: 0 }): ReplayTreeNode | null {
  if (!record(value) || depth > 32 || ++count.value > 2_000 || typeof value.tag !== 'string') return null
  if (value.tag === 'blocked') return value.blocked === true && keys(value, [ 'tag', 'blocked' ]) ? { tag: 'blocked', blocked: true } : null
  if (!tags.has(value.tag) || !Object.keys(value).every(key => [ 'tag', 'attrs', 'children' ].includes(key))) return null
  const safeAttrs = value.attrs === undefined ? undefined : replayAttrs(value.attrs)
  if (value.attrs !== undefined && !safeAttrs) return null
  if (value.children !== undefined && !Array.isArray(value.children)) return null
  const children: ReplayTreeNode[] = []
  if (value.children) for (const child of value.children) { const safeChild = replayTree(child, depth + 1, count); if (!safeChild) return null; children.push(safeChild) }
  return { tag: value.tag, ...(safeAttrs ? { attrs: safeAttrs } : {}), ...(children?.length ? { children } : {}) }
}

function replayAttrs(value: unknown): Record<string, string | boolean> | null {
  if (!record(value)) return null
  const entries = Object.entries(value)
  if (entries.length > 5 || !entries.every(([ key ]) => attrs.has(key))) return null
  const result: Record<string, string | boolean> = {}
  for (const [key, entry] of entries) {
    if ((key === 'disabled' || key === 'checked') && entry === true) result[key] = true
    else if (key === 'aria-hidden' && (entry === 'true' || entry === 'false')) result[key] = entry
    else if ((key === 'role' || key === 'type') && typeof entry === 'string' && /^[a-z][a-z0-9_-]{0,63}$/i.test(entry)) result[key] = entry
    else return null
  }
  return result
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype }
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean { const actual = Object.keys(value); return actual.length === expected.length && actual.every(key => expected.includes(key)) }

/**
 * The only executable code in the frame is this fixed renderer. Replay data is
 * never interpolated into HTML: it crosses the origin boundary by postMessage
 * and is reconstructed with createElement/setAttribute after validation.
 */
export function replayPlayerDocument(nonce: string): string {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><title>知迹安全回放</title><main id="root" aria-label="安全结构回放"></main><script nonce="${nonce}">(()=>{const T=new Set(['html','body','main','header','footer','nav','section','article','aside','div','span','p','br','hr','h1','h2','h3','h4','h5','h6','ul','ol','li','dl','dt','dd','table','thead','tbody','tfoot','tr','th','td','button','a','label','input','textarea','select','option','form','fieldset','legend','details','summary']);const A=new Set(['role','type','disabled','checked','aria-hidden']);const root=document.getElementById('root');const marker=document.createElement('div');marker.setAttribute('aria-hidden','true');function node(value,parent,state,depth){if(!value||typeof value!=='object'||depth>32||++state.count>2000)return false;if(value.tag==='blocked'&&value.blocked===true){const block=document.createElement('div');block.textContent='已遮罩';parent.append(block);return true}if(!T.has(value.tag))return false;const el=document.createElement(value.tag);if(value.attrs){for(const [key,val] of Object.entries(value.attrs)){if(!A.has(key)||(typeof val!=='string'&&val!==true))return false;el.setAttribute(key,val===true?'':val)}}parent.append(el);if(value.children){if(!Array.isArray(value.children))return false;for(const child of value.children)if(!node(child,el,state,depth+1))return false}return true}function state(value){if(!value||typeof value!=='object')return;const scroll=value.scroll;if(scroll&&Number.isInteger(scroll.x)&&Number.isInteger(scroll.y))scrollTo(scroll.x,scroll.y);const hit=value.interaction;if(hit&&Number.isInteger(hit.x)&&Number.isInteger(hit.y)){marker.style.cssText='position:fixed;left:'+hit.x+'px;top:'+hit.y+'px;width:14px;height:14px;border:2px solid #d92d20;border-radius:50%;box-sizing:border-box;pointer-events:none;z-index:2147483647';root.append(marker)}else marker.remove()}addEventListener('message',event=>{const data=event.data;if(!data||data.source!=='zhiji-replay-player')return;root.replaceChildren();if(!node(data.tree,root,{count:0},0)){root.textContent='片段不可回放';return}state(data.state)})})();</script>`
}
