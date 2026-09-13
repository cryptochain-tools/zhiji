import { randomBytes } from 'node:crypto'
import { Controller } from 'egg'
import { httpError, success } from '../lib/http'

const COOKIE = 'zj_session'
const CSRF_COOKIE = 'zj_csrf'
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export default class AuthController extends Controller {
  async register() {
    const body = objectBody(this.ctx.request.body)
    const result = await this.ctx.service.auth.index.register({ email: body.email, password: body.password, displayName: body.display_name, tenantName: body.tenant_name })
    setAuthCookies(this.ctx, result.token)
    success(this.ctx, { expires_at: result.expires_at }, 201)
  }
  async login() {
    const body = objectBody(this.ctx.request.body)
    const result = await this.ctx.service.auth.index.login({ email: body.email, password: body.password })
    setAuthCookies(this.ctx, result.token)
    success(this.ctx, { expires_at: result.expires_at })
  }
  async logout() {
    await this.ctx.service.auth.index.logout(this.ctx.state.auth ?? null)
    this.ctx.cookies.set(COOKIE, '', cookieOptions(this.ctx, 0))
    this.ctx.cookies.set(CSRF_COOKIE, '', csrfCookieOptions(this.ctx, 0))
    success(this.ctx, { revoked: true })
  }
  async tenants() {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const result = await this.ctx.service.auth.index.me(principal)
    success(this.ctx, { items: result.tenants, next_cursor: null })
  }
  async me() {
    const principal = this.ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    success(this.ctx, await this.ctx.service.auth.index.me(principal))
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'invalid_request', 'Request body must be an object')
  return value as Record<string, unknown>
}
export function setAuthCookies(ctx: Controller['ctx'], token: string): void {
  ctx.cookies.set(COOKIE, token, cookieOptions(ctx, COOKIE_MAX_AGE_MS))
  ctx.cookies.set(CSRF_COOKIE, randomBytes(32).toString('base64url'), csrfCookieOptions(ctx, COOKIE_MAX_AGE_MS))
}
function secureCookie(ctx: Controller['ctx']): boolean { return ctx.protocol === 'https' || process.env.NODE_ENV === 'production' }
function cookieOptions(ctx: Controller['ctx'], maxAge: number) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: secureCookie(ctx), overwrite: true, maxAge, signed: false, path: '/' }
}
function csrfCookieOptions(ctx: Controller['ctx'], maxAge: number) {
  return { httpOnly: false, sameSite: 'lax' as const, secure: secureCookie(ctx), overwrite: true, maxAge, signed: false, path: '/' }
}
