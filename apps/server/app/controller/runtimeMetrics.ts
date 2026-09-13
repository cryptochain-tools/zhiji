import { Controller } from 'egg'
import { success } from '../lib/http'

/**
 * Deployment operators should restrict this unauthenticated health-adjacent
 * endpoint to their monitoring network in the reverse proxy.  Its payload is
 * aggregate-only and intentionally contains no tenant or project information.
 */
export default class RuntimeMetricsController extends Controller {
  async show() {
    success(this.ctx, await this.ctx.service.runtimeMetrics.snapshot())
  }
}
