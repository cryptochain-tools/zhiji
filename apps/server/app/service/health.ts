import { Service } from 'egg'
import { HealthStatus } from '@zhiji/contracts'

export default class HealthService extends Service {
  async live(): Promise<HealthStatus> {
    return { status: 'ok', checks: { process: 'ok' } }
  }

  async ready(): Promise<HealthStatus> {
    const databaseReady = await this.config.zhiji.checkReadiness()
    return {
      status: databaseReady ? 'ok' : 'unavailable',
      checks: { database: databaseReady ? 'ok' : 'unavailable' },
    }
  }
}
