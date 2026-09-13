import { Controller } from 'egg'
import { httpError, success } from '../lib/http'
import { PostgreSqlBusinessUserDirectory, parseBusinessUserDirectoryRequest } from '../service/identity/directory'
import { ServerIngestDependencies } from '../service/ingest/transport'

interface IdentityDirectoryRuntime {
  resolveServerIngestProject?: ServerIngestDependencies['resolveProject']
}

const MAX_BYTES = 128 * 1024

/** Server-key-only user directory. Browser origins can never write contact data. */
export default class IdentityDirectoryController extends Controller {
  async upsert() {
    if (this.ctx.get('origin')) throw httpError(403, 'identity_directory_origin_forbidden', 'Business user profiles must be sent without an Origin header')
    const declaredLength = this.ctx.get('content-length')
    const length = declaredLength ? Number(declaredLength) : 0
    if (!Number.isFinite(length) || length < 0 || length > MAX_BYTES) throw httpError(413, 'identity_directory_payload_too_large', 'Profile payload exceeds the limit')
    const key = this.ctx.get('x-zhiji-key').trim()
    if (!key) throw httpError(401, 'missing_identity_directory_key', 'X-Zhiji-Key is required')
    if (Buffer.byteLength(JSON.stringify(this.ctx.request.body), 'utf8') > MAX_BYTES) throw httpError(413, 'identity_directory_payload_too_large', 'Profile payload exceeds the limit')
    const request = parseBusinessUserDirectoryRequest(this.ctx.request.body)
    if (request.key !== key) throw httpError(401, 'identity_directory_key_mismatch', 'Body key does not match X-Zhiji-Key')

    const runtime = this.app.config.zhiji as typeof this.app.config.zhiji & IdentityDirectoryRuntime
    const scope = await runtime.resolveServerIngestProject?.(key)
    if (!scope) throw httpError(401, 'invalid_identity_directory_key', 'X-Zhiji-Key must be an active server key')
    const accepted = await new PostgreSqlBusinessUserDirectory(runtime.database).upsert(scope, request.profiles)
    success(this.ctx, { accepted }, 202)
  }
}
