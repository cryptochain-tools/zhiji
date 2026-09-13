import { Context } from 'egg'

export default function notFound() {
  return async (ctx: Context, next: () => Promise<void>) => {
    await next()
    if (ctx.status === 404 && ctx.body === undefined) {
      ctx.body = {
        error: { code: 'not_found', message: 'Route not found' },
        meta: { request_id: ctx.state.requestId },
      }
    }
  }
}
