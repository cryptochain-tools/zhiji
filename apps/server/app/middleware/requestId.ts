import { Context } from 'egg'
import { randomUUID } from 'node:crypto'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/

export default function requestId() {
  return async (ctx: Context, next: () => Promise<void>) => {
    const supplied = ctx.get('x-request-id')
    const requestId = REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID()
    ctx.state.requestId = requestId
    ctx.set('X-Request-ID', requestId)
    ctx.set('Access-Control-Expose-Headers', 'X-Request-ID, ETag')
    await next()
  }
}
