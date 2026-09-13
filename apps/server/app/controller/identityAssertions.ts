import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { mintIdentityAssertion } from '../service/identity/assertions'
import { ServerIngestDependencies } from '../service/ingest/transport'

interface IdentityAssertionRuntime {
  resolveServerIngestProject?: ServerIngestDependencies['resolveProject']
}

interface IdentityAssertionRequest {
  visitorId: string
  businessUserId: string
}

/**
 * A server-key-only bridge for applications that need to bind a browser visitor
 * to their already-authenticated business user. It deliberately accepts no
 * caller-provided tenant/project scope and never emits CORS headers.
 */
export default class IdentityAssertionsController extends Controller {
  async create() {
    if (this.ctx.get('origin')) {
      throw httpError(403, 'identity_assertion_origin_forbidden', 'Identity assertions must be requested without an Origin header')
    }
    const key = this.ctx.get('x-zhiji-key')
    if (!key) throw httpError(401, 'missing_identity_assertion_key', 'X-Zhiji-Key is required')

    const runtime = this.app.config.zhiji as typeof this.app.config.zhiji & IdentityAssertionRuntime
    if (!runtime.resolveServerIngestProject) {
      throw httpError(503, 'identity_assertion_auth_unavailable', 'Identity assertion authentication is unavailable')
    }
    const scope = await runtime.resolveServerIngestProject(key)
    if (!scope) throw httpError(401, 'invalid_identity_assertion_key', 'X-Zhiji-Key must be an active server key')

    const request = parseIdentityAssertionRequest(this.ctx.request.body)
    const issued = await mintIdentityAssertion(this.app.config.zhiji.database, {
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      visitorId: request.visitorId,
      businessUserId: request.businessUserId,
    })
    this.ctx.set('Cache-Control', 'no-store')
    this.ctx.set('Pragma', 'no-cache')
    success(this.ctx, { assertion: issued.assertion, expires_at: issued.expiresAt.toISOString() }, 201)
  }
}

export function parseIdentityAssertionRequest(value: unknown): IdentityAssertionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw httpError(400, 'invalid_identity_assertion_request', 'Request body must be an object')
  }
  const body = value as Record<string, unknown>
  const allowed = new Set([ 'visitor_id', 'business_user_id' ])
  if (Object.keys(body).some(key => !allowed.has(key))) {
    throw httpError(400, 'invalid_identity_assertion_request', 'Request body contains unsupported fields')
  }
  return {
    visitorId: validScopedId(body.visitor_id, 'visitor_id'),
    businessUserId: validScopedId(body.business_user_id, 'business_user_id'),
  }
}

function validScopedId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || value.trim() !== value) {
    throw httpError(400, 'invalid_identity_assertion_request', `${field} must be a non-empty trimmed string of at most 128 characters`)
  }
  return value
}
