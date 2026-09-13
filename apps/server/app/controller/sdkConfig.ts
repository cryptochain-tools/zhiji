import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { normalizeOrigin } from '../service/sdkConfig'

export default class SdkConfigController extends Controller {
  private setCorsHeaders(origin: string) {
    this.ctx.set('Access-Control-Allow-Origin', origin)
    this.ctx.set('Access-Control-Allow-Headers', 'X-Zhiji-Key, If-None-Match, X-Request-ID')
    this.ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    this.ctx.set('Access-Control-Max-Age', '300')
    this.ctx.set('Vary', 'Origin, X-Zhiji-Key')
  }

  async preflight() {
    const { ctx } = this
    // A CORS preflight never includes the requested X-Zhiji-Key value. It only
    // declares that the actual request intends to use that header. Validate the
    // caller shape here, then authenticate the key and project Origin on GET.
    const origin = normalizeOrigin(ctx.get('origin'))
    if (!origin) throw httpError(400, 'invalid_origin', 'Origin must be an exact HTTP(S) origin')
    this.setCorsHeaders(origin)
    ctx.status = 204
  }

  async show() {
    const { ctx } = this
    const key = ctx.get('x-zhiji-key')
    // Browsers commonly omit Origin on same-origin GET requests. In that case
    // the request target is the calling origin; the configured project
    // allowlist still decides whether it is accepted.
    const requestOrigin = ctx.get('origin')
    const origin = requestOrigin || ctx.origin
    const result = await ctx.service.sdkConfig.get({
      key,
      origin,
      ifNoneMatch: ctx.get('if-none-match') || undefined,
    })

    if (requestOrigin) this.setCorsHeaders(origin)
    ctx.set('Cache-Control', `private, max-age=${result.maxAge}`)
    ctx.set('ETag', result.etag)
    if (ctx.get('if-none-match') === result.etag) {
      ctx.status = 304
      return
    }
    success(ctx, result.config)
  }
}
