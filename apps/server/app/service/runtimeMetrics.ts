import { Service } from 'egg'
import { httpError } from '../lib/http'
import { DatabaseClient } from './database/types'

export interface RuntimeMetricsSnapshot {
  status: 'ok'
  observed_at: string
  outbox: {
    available: number
    leased: number
    expired_leases: number
    oldest_available_age_seconds: number | null
  }
  jobs: {
    queued: number
    running: number
    failed: number
    available: number
    leased: number
    expired_leases: number
    oldest_available_age_seconds: number | null
  }
}

interface RuntimeMetricsRow {
  observed_at: Date | string
  outbox_available: number | string
  outbox_leased: number | string
  outbox_expired_leases: number | string
  outbox_oldest_available_age_seconds: number | string | null
  jobs_queued: number | string
  jobs_running: number | string
  jobs_failed: number | string
  jobs_available: number | string
  jobs_leased: number | string
  jobs_expired_leases: number | string
  jobs_oldest_available_age_seconds: number | string | null
}

/**
 * Deliberately contains only deployment-wide queue health.  It never returns
 * tenant, project, worker identity, payload, or error details, so an internal
 * probe can alert on backlog without becoming a management-data endpoint.
 */
export class RuntimeMetricsService {
  constructor(private readonly database: DatabaseClient) {}

  async snapshot(): Promise<RuntimeMetricsSnapshot> {
    const result = await this.database.query<RuntimeMetricsRow>(`
      SELECT now() AS observed_at,
        (SELECT count(*) FROM outbox_messages
          WHERE delivered_at IS NULL AND discarded_at IS NULL
            AND available_at <= now()
            AND (lease_expires_at IS NULL OR lease_expires_at <= now())) AS outbox_available,
        (SELECT count(*) FROM outbox_messages
          WHERE delivered_at IS NULL AND discarded_at IS NULL
            AND lease_expires_at > now()) AS outbox_leased,
        (SELECT count(*) FROM outbox_messages
          WHERE delivered_at IS NULL AND discarded_at IS NULL
            AND lease_expires_at <= now()) AS outbox_expired_leases,
        (SELECT extract(epoch FROM now() - min(available_at))
          FROM outbox_messages
          WHERE delivered_at IS NULL AND discarded_at IS NULL
            AND available_at <= now()
            AND (lease_expires_at IS NULL OR lease_expires_at <= now())) AS outbox_oldest_available_age_seconds,
        (SELECT count(*) FROM worker_jobs WHERE status = 'queued') AS jobs_queued,
        (SELECT count(*) FROM worker_jobs WHERE status = 'running') AS jobs_running,
        (SELECT count(*) FROM worker_jobs WHERE status = 'failed') AS jobs_failed,
        (SELECT count(*) FROM worker_jobs
          WHERE status = 'queued' AND available_at <= now()) AS jobs_available,
        (SELECT count(*) FROM worker_jobs
          WHERE status = 'running' AND lease_expires_at > now()) AS jobs_leased,
        (SELECT count(*) FROM worker_jobs
          WHERE status = 'running' AND lease_expires_at <= now()) AS jobs_expired_leases,
        (SELECT extract(epoch FROM now() - min(available_at))
          FROM worker_jobs
          WHERE status = 'queued' AND available_at <= now()) AS jobs_oldest_available_age_seconds`)
    const row = result.rows[0]
    if (!row) throw new Error('runtime metrics query returned no row')
    return {
      status: 'ok',
      observed_at: new Date(row.observed_at).toISOString(),
      outbox: {
        available: nonNegativeInteger(row.outbox_available),
        leased: nonNegativeInteger(row.outbox_leased),
        expired_leases: nonNegativeInteger(row.outbox_expired_leases),
        oldest_available_age_seconds: ageSeconds(row.outbox_oldest_available_age_seconds),
      },
      jobs: {
        queued: nonNegativeInteger(row.jobs_queued),
        running: nonNegativeInteger(row.jobs_running),
        failed: nonNegativeInteger(row.jobs_failed),
        available: nonNegativeInteger(row.jobs_available),
        leased: nonNegativeInteger(row.jobs_leased),
        expired_leases: nonNegativeInteger(row.jobs_expired_leases),
        oldest_available_age_seconds: ageSeconds(row.jobs_oldest_available_age_seconds),
      },
    }
  }
}

export default class RuntimeMetricsEggService extends Service {
  async snapshot(): Promise<RuntimeMetricsSnapshot> {
    if (!this.config.zhiji.database.configured) throw httpError(503, 'runtime_metrics_unavailable', 'Runtime metrics are unavailable')
    try {
      return await new RuntimeMetricsService(this.config.zhiji.database).snapshot()
    } catch {
      // An internal observer should see unavailable rather than database or
      // schema details.  Readiness remains the diagnostic endpoint for schema.
      throw httpError(503, 'runtime_metrics_unavailable', 'Runtime metrics are unavailable')
    }
  }
}

function nonNegativeInteger(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('runtime metrics count is invalid')
  return parsed
}

function ageSeconds(value: number | string | null): number | null {
  if (value === null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('runtime metrics age is invalid')
  return Math.floor(parsed)
}
