import { Controller } from 'egg'
import { success } from '../lib/http'
import { IngestTransportError, IngestWriter, MobileIngestDependencies, processMobileIngest } from '../service/ingest/transport'
import { IngestRateLimiter } from '../service/ingest/rateLimit'

const MAX_BYTES = 256 * 1024

interface MobileIngestRuntime {
  resolveMobileIngestProject?: MobileIngestDependencies['resolveProject']
  ingestWriter?: IngestWriter
  ingestRateLimiter?: IngestRateLimiter
}

/** Native clients use declaration headers; they intentionally receive no CORS support. */
export default class MobileIngestController extends Controller {
  async events() { await this.ingest('analytics') }
  async errors() { await this.ingest('error') }

  private async ingest(lane: 'analytics' | 'error') {
    this.assertRequestSize()
    const runtime = this.app.config.zhiji as typeof this.app.config.zhiji & MobileIngestRuntime
    const result = await processMobileIngest({
      lane,
      keyHeader: this.ctx.get('x-zhiji-key'),
      platformHeader: this.ctx.get('x-zhiji-mobile-platform'),
      applicationIdHeader: this.ctx.get('x-zhiji-app-id'),
      applicationVersionHeader: this.ctx.get('x-zhiji-app-version'),
      body: this.ctx.request.body,
    }, { resolveProject: runtime.resolveMobileIngestProject ?? (async () => null), writer: runtime.ingestWriter, rateLimiter: runtime.ingestRateLimiter })
    this.ctx.set('X-Zhiji-Mobile-Verification', 'declaration-only')
    success(this.ctx, result.counts, 202)
  }

  private assertRequestSize() {
    const raw = this.ctx.get('content-length')
    const length = raw ? Number(raw) : 0
    if (!Number.isFinite(length) || length < 0 || length > MAX_BYTES) throw new IngestTransportError(413, 'ingest_payload_too_large', 'Ingest payload exceeds lane limit')
  }
}
