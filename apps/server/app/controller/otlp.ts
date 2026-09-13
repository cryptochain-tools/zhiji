import { Controller } from 'egg'
import { success } from '../lib/http'
import { IngestWriter } from '../service/ingest/transport'
import { IngestRateLimiter } from '../service/ingest/rateLimit'
import { OtlpDependencies, OtlpSignal, OtlpTransportError, processOtlp } from '../service/otlp'

const MAX_BYTES = 512 * 1024
interface OtlpRuntime { resolveOtlpProject?: OtlpDependencies['resolveProject']; ingestWriter?: IngestWriter; ingestRateLimiter?: IngestRateLimiter }

/** JSON OTLP subset only. This endpoint is not a generic OTLP collector. */
export default class OtlpController extends Controller {
  async traces() { await this.ingest('traces') }
  async metrics() { await this.ingest('metrics') }
  async logs() { await this.ingest('logs') }
  private async ingest(signal: OtlpSignal) {
    const contentType = this.ctx.get('content-type').split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') throw new OtlpTransportError(415, 'otlp_json_required', 'Only OTLP/HTTP JSON is supported')
    const length = Number(this.ctx.get('content-length') || 0)
    if (!Number.isFinite(length) || length < 0 || length > MAX_BYTES) throw new OtlpTransportError(413, 'otlp_payload_too_large', 'OTLP payload exceeds limit')
    const runtime = this.app.config.zhiji as typeof this.app.config.zhiji & OtlpRuntime
    const counts = await processOtlp(signal, this.ctx.get('x-zhiji-key'), this.ctx.request.body, { resolveProject: runtime.resolveOtlpProject ?? (async () => null), writer: runtime.ingestWriter, rateLimiter: runtime.ingestRateLimiter })
    success(this.ctx, counts, 202)
  }
}
