import { Context } from 'egg'

export function success<T>(ctx: Context, data: T, status = 200) {
  ctx.status = status
  ctx.body = { data, meta: { request_id: ctx.state.requestId } }
}

export function httpError(status: number, code: string, message: string, details?: Record<string, string>): Error {
  const error = new Error(message) as Error & { status: number; code: string; details?: Record<string, string> }
  error.status = status
  error.code = code
  if (details) error.details = details
  return error
}
