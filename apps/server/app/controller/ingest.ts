import { Controller } from 'egg'
import { IngestLane } from '../contracts/ingest'
import { success } from '../lib/http'
import { IngestDependencies, IngestTransportError, IngestWriter, processIngest } from '../service/ingest/transport'
import { IngestRateLimiter } from '../service/ingest/rateLimit'

const MAX_BYTES: Record<IngestLane, number> = {
  analytics: 256 * 1024,
  error: 256 * 1024,
  behavior: 256 * 1024,
  performance: 256 * 1024,
  replay: 1500 * 1024,
}

interface IngestRuntime {
  resolveIngestProject?: IngestDependencies['resolveProject']
  ingestWriter?: IngestWriter
  ingestRateLimiter?: IngestRateLimiter
}

export default class IngestController extends Controller {
  async events() { await this.ingest('analytics') }
  async errors() { await this.ingest('error') }
  async behavior() { await this.ingest('behavior') }
  async replays() { await this.ingest('replay') }
  async performance() { await this.ingest('performance') }

  async preflight() {
    const origin = this.ctx.get('origin')
    if (!origin) throw new IngestTransportError(400, 'invalid_origin', 'Origin must be an exact HTTP(S) origin')
    this.setCorsHeaders(origin)
    this.ctx.status = 204
  }

  private async ingest(lane: IngestLane) {
    this.assertRequestSize(lane)
    const result = await processIngest({
      lane,
      keyHeader: this.ctx.get('x-zhiji-key'),
      origin: this.ctx.get('origin'),
      body: this.ctx.request.body,
    }, this.dependencies())
    this.setCorsHeaders(this.ctx.get('origin'))
    success(this.ctx, { ...result.counts, ...(result.sessionId ? { session_id: result.sessionId } : {}) }, 202)
  }

  private dependencies(): IngestDependencies {
    const runtime = this.app.config.zhiji as typeof this.app.config.zhiji & IngestRuntime
    return {
      resolveProject: runtime.resolveIngestProject ?? (async () => null),
      writer: runtime.ingestWriter,
      rateLimiter: runtime.ingestRateLimiter,
    }
  }

  private setCorsHeaders(origin: string) {
    this.ctx.set('Access-Control-Allow-Origin', origin)
    this.ctx.set('Access-Control-Allow-Headers', 'Content-Type, X-Zhiji-Key, X-Request-ID')
    this.ctx.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    this.ctx.set('Access-Control-Max-Age', '300')
    this.ctx.set('Access-Control-Expose-Headers', 'X-Request-ID')
    this.ctx.set('Vary', 'Origin, X-Zhiji-Key')
  }

  private assertRequestSize(lane: IngestLane) {
    const contentLength = this.ctx.get('content-length')
    const parsed = contentLength ? Number(contentLength) : 0
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_BYTES[lane]) {
      throw new IngestTransportError(413, 'ingest_payload_too_large', 'Ingest payload exceeds lane limit')
    }
  }
}
