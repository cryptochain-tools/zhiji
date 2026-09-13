import { Controller } from 'egg'
import { success } from '../lib/http'
import { IngestTransportError, IngestWriter, ServerIngestDependencies, processServerIngest } from '../service/ingest/transport'
import { IngestRateLimiter } from '../service/ingest/rateLimit'

const MAX_BYTES = 256 * 1024

interface ServerIngestRuntime {
  resolveServerIngestProject?: ServerIngestDependencies['resolveProject']
  ingestWriter?: IngestWriter
  ingestRateLimiter?: IngestRateLimiter
}

/** Endpoints for the Node SDK. They do not emit CORS headers by design. */
export default class ServerIngestController extends Controller {
  async events() { await this.ingest('analytics') }
  async errors() { await this.ingest('error') }

  private async ingest(lane: 'analytics' | 'error') {
    this.assertRequestSize()
    const runtime = this.app.config.zhiji as typeof this.app.config.zhiji & ServerIngestRuntime
    const result = await processServerIngest({
      lane, keyHeader: this.ctx.get('x-zhiji-key'), origin: this.ctx.get('origin') || undefined, body: this.ctx.request.body,
    }, {
      resolveProject: runtime.resolveServerIngestProject ?? (async () => null), writer: runtime.ingestWriter, rateLimiter: runtime.ingestRateLimiter,
    })
    success(this.ctx, result.counts, 202)
  }

  private assertRequestSize() {
    const raw = this.ctx.get('content-length')
    const length = raw ? Number(raw) : 0
    if (!Number.isFinite(length) || length < 0 || length > MAX_BYTES) {
      throw new IngestTransportError(413, 'ingest_payload_too_large', 'Ingest payload exceeds lane limit')
    }
  }
}
