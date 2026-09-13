import { Context } from 'egg'
import { httpError } from '../lib/http'

/** State-changing cookie requests require the configured application Origin. */
export default function authOrigin(): (ctx: Context, next: () => Promise<unknown>) => Promise<void> {
  return async (ctx, next) => {
    const configured = ctx.app.config.zhiji.appOrigin
    const origin = ctx.get('origin')
    if (!configured || origin !== configured) throw httpError(403, 'origin_not_allowed', 'Origin is not allowed')
    await next()
  }
}
