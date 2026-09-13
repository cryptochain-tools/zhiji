import { Controller } from 'egg'
import { success } from '../lib/http'

export default class HealthController extends Controller {
  async live() {
    success(this.ctx, await this.ctx.service.health.live())
  }

  async ready() {
    const result = await this.ctx.service.health.ready()
    success(this.ctx, result, result.status === 'ok' ? 200 : 503)
  }
}
