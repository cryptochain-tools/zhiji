import { Context } from 'egg'
import { httpError } from '../lib/http'

/** Authentication is read from the HttpOnly cookie only; bearer tokens are not accepted for console APIs. */
export default function authSession(): (ctx: Context, next: () => Promise<unknown>) => Promise<void> {
  return async (ctx, next) => {
    const token = ctx.cookies.get('zj_session', { signed: false })
    const principal = await ctx.service.auth.index.authenticate(token)
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    ctx.state.auth = principal
    await next()
  }
}
