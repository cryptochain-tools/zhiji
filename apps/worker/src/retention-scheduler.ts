import { randomUUID } from 'node:crypto'
import { DatabaseClient } from '../../server/app/service/database/types'

type ActiveProject = { tenant_id: string; project_id: string }

/**
 * Enqueues one bounded cleanup pass per active project and UTC day. The unique
 * worker-job key makes concurrent worker processes harmless; cleanup itself
 * still owns deletion ordering, leases, and watermarks.
 */
export class RetentionScheduleScanner {
  constructor(private readonly database: DatabaseClient, private readonly now: () => Date = () => new Date()) {}

  async scan(limit = 100): Promise<{ projects: number; retentionJobs: number; sourceMapJobs: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error('invalid_retention_schedule_scan_limit')
    const projects = await this.database.query<ActiveProject>(
      `SELECT tenant_id, id AS project_id FROM projects
       WHERE deletion_status='active' ORDER BY tenant_id ASC,id ASC LIMIT $1`, [ limit ],
    )
    const day = utcDay(this.now()); let retentionJobs = 0; let sourceMapJobs = 0
    for (const project of projects.rows) {
      if (await enqueue(this.database, project, 'retention_cleanup', `retention:${day}`)) retentionJobs += 1
      if (await enqueue(this.database, project, 'sourcemap_cleanup', `sourcemap:${day}`)) sourceMapJobs += 1
    }
    return { projects: projects.rows.length, retentionJobs, sourceMapJobs }
  }
}

async function enqueue(database: DatabaseClient, project: ActiveProject, kind: 'retention_cleanup' | 'sourcemap_cleanup', key: string): Promise<boolean> {
  const result = await database.query<{ inserted: boolean }>(
    `INSERT INTO worker_jobs (id,tenant_id,project_id,kind,idempotency_key,payload,max_attempts)
     VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,10)
     ON CONFLICT(tenant_id,project_id,kind,idempotency_key) DO UPDATE SET id=worker_jobs.id
     RETURNING (xmax=0) AS inserted`,
    [ randomUUID(), project.tenant_id, project.project_id, kind, key ],
  )
  return result.rows[0]?.inserted === true
}

function utcDay(value: Date): string { return value.toISOString().slice(0, 10) }
