import { Context } from 'egg'

interface PublicError extends Error {
  status?: number
  code?: string
  details?: Record<string, string>
}

export default function errorBoundary() {
  return async (ctx: Context, next: () => Promise<void>) => {
    try {
      await next()
    } catch (error) {
      const publicError = error as PublicError
      const status = publicError.status && publicError.status >= 400 && publicError.status < 600
        ? publicError.status
        : 500
      const code = publicError.code || 'internal_error'
      const requestId = ctx.state.requestId as string

      ctx.app.logger.error({
        request_id: requestId,
        module: 'http',
        action: 'request_failed',
        result: 'error',
        reason_code: code,
        err: error,
      })
      ctx.status = status
      ctx.body = {
        error: {
          code,
          message: status === 500 ? 'Internal server error' : publicError.message,
          ...(status < 500 && publicError.details ? { details: publicError.details } : {}),
        },
        meta: { request_id: requestId },
      }
    }
  }
}
