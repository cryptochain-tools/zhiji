import { randomUUID } from 'node:crypto'
import { DatabaseClient, PostgreSqlConnection } from '../../server/app/service/database/types'
import { LeasedWorkerJob, WorkerHandlers } from '../../server/app/service/worker'
import { AlertRuleType, SafeAlertSummary, scrubAlertSummary } from '../../server/app/service/alerts/contracts'

type TransactionDriver = DatabaseClient & { connect(): Promise<PostgreSqlConnection> }
type Rule = { id: string; rule_type: AlertRuleType; condition_json: Record<string, unknown>; created_at: Date }
type Candidate = { group_key: string; summary: Record<string, unknown> }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Evaluates only the fixed alert-rule vocabulary against project-scoped facts.
 * It never receives endpoints, target configuration, stack data, URLs or user
 * identifiers.  A notification target is rechecked by queueDelivery's scoped
 * SELECT at the same transaction that creates the delivery/outbox record.
 */
export class AlertEvaluationHandler implements Pick<WorkerHandlers, 'runJob'> {
  constructor(private readonly database: TransactionDriver) {}

  async runJob(job: LeasedWorkerJob): Promise<{ processedCount: number; failedCount: number; watermark?: Record<string, unknown> }> {
    if (job.kind !== 'alert_evaluation') throw new Error(`unsupported_worker_job:${job.kind}`)
    return this.transaction(async database => {
      const active = await database.query<{ id: string }>(
        `SELECT id FROM projects WHERE tenant_id = $1 AND id = $2 AND deletion_status = 'active' FOR SHARE`,
        [ job.tenant_id, job.project_id ],
      )
      if (!active.rows[0]) return { processedCount: 0, failedCount: 0, watermark: { skipped: 'project_not_active' } }
      const rules = await database.query<Rule>(
        `SELECT id, rule_type, condition_json, created_at FROM alert_rules
         WHERE tenant_id = $1 AND project_id = $2 AND enabled = true
         ORDER BY created_at ASC, id ASC FOR SHARE`, [ job.tenant_id, job.project_id ],
      )
      let processed = 0
      let enqueued = 0
      for (const rule of rules.rows) {
        const candidates = await this.candidates(database, job, rule)
        for (const candidate of candidates) {
          processed += 1
          const instance = await upsertInstance(database, job, rule, candidate.group_key, scrubAlertSummary(candidate.summary))
          if (!instance.enqueued) continue
          enqueued += await queueTargets(database, job, instance.id)
        }
      }
      return { processedCount: processed, failedCount: 0, watermark: { evaluated_rules: rules.rows.length, delivery_candidates: enqueued } }
    })
  }

  private async candidates(database: DatabaseClient, job: LeasedWorkerJob, rule: Rule): Promise<Candidate[]> {
    const condition = validCondition(rule.rule_type, rule.condition_json)
    switch (rule.rule_type) {
      case 'error_new': return rows(await database.query<Candidate>(
        `SELECT groups.id::text AS group_key, jsonb_build_object('release', groups.release) AS summary
         FROM error_groups groups WHERE groups.tenant_id = $1 AND groups.project_id = $2
           AND groups.first_seen >= $3`, [ job.tenant_id, job.project_id, rule.created_at ]))
      case 'error_regression': return rows(await database.query<Candidate>(
        `SELECT groups.id::text || ':' || groups.state_version::text AS group_key, jsonb_build_object('release', groups.release) AS summary
         FROM error_groups groups WHERE groups.tenant_id = $1 AND groups.project_id = $2 AND groups.status = 'unresolved'
           AND groups.state_version > 0 AND groups.last_seen >= $3`, [ job.tenant_id, job.project_id, rule.created_at ]))
      case 'error_count': return rows(await database.query<Candidate>(
        `SELECT occurrences.group_id::text || ':' || $3::text AS group_key,
                jsonb_build_object('count', count(*)::integer, 'window_seconds', $3, 'release', max(occurrences.release)) AS summary
         FROM error_occurrences occurrences WHERE occurrences.tenant_id = $1 AND occurrences.project_id = $2
           AND occurrences.occurred_at >= now() - ($3 * interval '1 second')
         GROUP BY occurrences.group_id HAVING count(*) >= $4`, [ job.tenant_id, job.project_id, condition.window, condition.threshold ]))
      case 'performance_p75': return rows(await database.query<Candidate>(
        `SELECT metric_name || ':' || coalesce(page_key, '') || ':' || coalesce(release, '') || ':' || $3::text AS group_key,
                jsonb_build_object('metric', metric_name, 'sample_count', count(*)::integer, 'window_seconds', $3,
                  'release', max(release)) AS summary
         FROM performance_observations WHERE tenant_id = $1 AND project_id = $2
           AND occurred_at >= now() - ($3 * interval '1 second')
           AND ($5::text IS NULL OR metric_name = $5)
         GROUP BY metric_name, page_key, release HAVING count(*) >= $4 AND percentile_cont(0.75) WITHIN GROUP (ORDER BY value) > $6`,
        [ job.tenant_id, job.project_id, condition.window, condition.minimumSamples, condition.metric, condition.threshold ]))
      case 'performance_rating': return rows(await database.query<Candidate>(
        `SELECT metric_name || ':' || coalesce(page_key, '') || ':' || coalesce(release, '') || ':' || $3::text AS group_key,
                jsonb_build_object('metric', metric_name, 'sample_count', count(*)::integer, 'window_seconds', $3,
                  'poor_ratio', avg((rating = 'poor')::integer), 'release', max(release)) AS summary
         FROM performance_observations WHERE tenant_id = $1 AND project_id = $2
           AND occurred_at >= now() - ($3 * interval '1 second')
           AND ($5::text IS NULL OR metric_name = $5)
         GROUP BY metric_name, page_key, release HAVING count(*) >= $4 AND avg((rating = 'poor')::integer) >= $6`,
        [ job.tenant_id, job.project_id, condition.window, condition.minimumSamples, condition.metric, condition.threshold ]))
    }
  }

  private async transaction<T>(run: (database: PostgreSqlConnection) => Promise<T>): Promise<T> {
    const connection = await this.database.connect()
    try { await connection.query('BEGIN'); const value = await run(connection); await connection.query('COMMIT'); return value }
    catch (error) { try { await connection.query('ROLLBACK') } catch { /* retain original */ } throw error }
    finally { connection.release() }
  }
}

function rows(result: { rows: Candidate[] }): Candidate[] { return result.rows.filter(row => typeof row.group_key === 'string' && row.group_key.length <= 400) }
function validCondition(type: AlertRuleType, value: Record<string, unknown>): { window: number; threshold: number; minimumSamples: number; metric: string | null } {
  if (type === 'error_new' || type === 'error_regression') return { window: 0, threshold: 0, minimumSamples: 0, metric: null }
  const window = value.window_seconds
  const threshold = value.threshold
  const minimumSamples = value.minimum_samples
  if ((window !== 300 && window !== 900 && window !== 3600 && window !== 86400) || typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0) throw new Error('invalid_alert_rule_condition')
  if (type.startsWith('performance_') && (!Number.isSafeInteger(minimumSamples) || (minimumSamples as number) < 1)) throw new Error('invalid_alert_rule_condition')
  const metric = typeof value.metric === 'string' && /^[A-Z]{2,10}$/.test(value.metric) ? value.metric : null
  return { window, threshold, minimumSamples: type.startsWith('performance_') ? minimumSamples as number : 0, metric }
}

async function upsertInstance(database: DatabaseClient, job: LeasedWorkerJob, rule: Rule, groupKey: string, summary: SafeAlertSummary): Promise<{ id: string; enqueued: boolean }> {
  const cooldownSeconds = rule.rule_type.startsWith('performance_') ? 6 * 3600 : rule.rule_type === 'error_count' ? 30 * 60 : rule.rule_type === 'error_regression' ? 4 * 3600 : 24 * 3600
  // `error_new` and a state-versioned `error_regression` are edge triggers.
  // Re-evaluating unchanged facts after their nominal cooldown must never turn
  // them into recurring alerts; count/performance rules are level triggers.
  const rearm = rule.rule_type === 'error_count' || rule.rule_type.startsWith('performance_')
  const result = await database.query<{ id: string; enqueued: boolean }>(
    `WITH locked AS (SELECT id, cooldown_until FROM alert_instances WHERE rule_id = $1 AND group_key = $2 FOR UPDATE),
     changed AS (UPDATE alert_instances SET status = 'active', last_evaluated_at = now(), payload_summary = $6::jsonb,
       last_triggered_at = CASE WHEN $8 AND locked.cooldown_until <= now() THEN now() ELSE alert_instances.last_triggered_at END,
       cooldown_until = CASE WHEN $8 AND locked.cooldown_until <= now() THEN now() + ($7 * interval '1 second') ELSE alert_instances.cooldown_until END
       FROM locked WHERE alert_instances.id = locked.id RETURNING alert_instances.id, ($8 AND locked.cooldown_until <= now()) AS enqueued),
     inserted AS (INSERT INTO alert_instances (id, tenant_id, project_id, rule_id, group_key, status, first_triggered_at, last_triggered_at, last_evaluated_at, cooldown_until, payload_summary)
       SELECT $3,$4,$5,$1,$2,'active',now(),now(),now(),now() + ($7 * interval '1 second'),$6::jsonb WHERE NOT EXISTS (SELECT 1 FROM locked)
       ON CONFLICT (rule_id, group_key) DO NOTHING RETURNING id, true AS enqueued)
     SELECT id, enqueued FROM changed UNION ALL SELECT id, enqueued FROM inserted`,
    [ rule.id, groupKey, randomUUID(), job.tenant_id, job.project_id, JSON.stringify(summary), cooldownSeconds, rearm ],
  )
  const row = result.rows[0]
  if (!row) return { id: '', enqueued: false }
  return row
}

async function queueTargets(database: DatabaseClient, job: LeasedWorkerJob, instanceId: string): Promise<number> {
  if (!uuid.test(instanceId)) return 0
  const result = await database.query(
    `WITH targets AS (SELECT targets.id FROM alert_instances instances JOIN alert_rule_targets links ON links.rule_id = instances.rule_id JOIN notification_targets targets ON targets.id = links.target_id
      JOIN alert_rules rules ON rules.id = links.rule_id WHERE instances.id = $1 AND instances.tenant_id = $2 AND instances.project_id = $3 AND rules.tenant_id = $2 AND rules.project_id = $3
       AND rules.enabled AND targets.tenant_id = $2 AND targets.project_id = $3 AND targets.enabled AND targets.verified_at IS NOT NULL),
     deliveries AS (INSERT INTO notification_deliveries (id, tenant_id, project_id, alert_instance_id, target_id)
      SELECT gen_random_uuid(), $2, $3, $4, id FROM targets ON CONFLICT (alert_instance_id, target_id, payload_version) DO NOTHING RETURNING id),
     queued AS (INSERT INTO outbox_messages (id, tenant_id, project_id, topic, idempotency_key, payload, max_attempts)
      SELECT gen_random_uuid(), $2, $3, 'notification_delivery', 'notification-delivery:' || id, jsonb_build_object('notification_delivery_id', id), 5 FROM deliveries RETURNING id)
     SELECT id FROM queued`, [ instanceId, job.tenant_id, job.project_id, instanceId ])
  return result.rowCount ?? 0
}
