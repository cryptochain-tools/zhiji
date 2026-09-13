import { Context } from 'egg'
import { timingSafeEqual } from 'node:crypto'
import { httpError } from '../lib/http'

/** Double-submit CSRF token; session cookie remains HttpOnly and the token is never a bearer credential. */
export default function authCsrf(): (ctx: Context, next: () => Promise<unknown>) => Promise<void> {
  return async (ctx, next) => {
    const cookie = ctx.cookies.get('zj_csrf', { signed: false })
    const header = ctx.get('x-csrf-token')
    if (!cookie || !header || cookie.length !== header.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
      throw httpError(403, 'csrf_invalid', 'CSRF validation failed')
    }
    await next()
  }
}
