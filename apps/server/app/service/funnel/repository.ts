import { DatabaseClient } from '../database/types'
import { FunnelQuery, FunnelStepCount } from './contracts'

interface FunnelRow extends Record<string, unknown> {}

/**
 * Calculates a small funnel in PostgreSQL. Facts are constrained before the
 * identity expansion; business-user expansion then deduplicates each
 * (event_id, business_user_id) pair and never changes visitor fact totals.
 */
export class FunnelRepository {
  constructor(private readonly database: DatabaseClient) {}

  async counts(query: FunnelQuery): Promise<{ steps: FunnelStepCount[]; sourceEventCount: number }> {
    const result = await this.database.query<FunnelRow>(sqlFor(query), valuesFor(query))
    const row = result.rows[0] ?? {}
    return {
      steps: query.steps.map((name, index) => ({ name, count: integer(row[`step_${index + 1}_count`]) })),
      sourceEventCount: integer(row.source_event_count),
    }
  }
}

function valuesFor(query: FunnelQuery): readonly unknown[] {
  return [ query.tenantId, query.projectId, query.from, query.to, query.steps, ...query.steps ]
}

function sqlFor(query: FunnelQuery): string {
  const source = query.subjectKind === 'visitor'
    ? `SELECT id, client_instance_id, client_sequence, name, occurred_at, visitor_id AS subject_id
       FROM scoped_events`
    : `SELECT DISTINCT e.id, e.client_instance_id, e.client_sequence, e.name, e.occurred_at, i.business_user_id AS subject_id
       FROM scoped_events e
       JOIN identities i ON i.tenant_id = $1 AND i.project_id = $2 AND i.visitor_id = e.visitor_id`
  const steps = query.steps.map((_, index) => stepCte(index + 1)).join(',\n')
  const counts = [
    `(SELECT COUNT(*)::integer FROM scoped_events) AS source_event_count`,
    ...query.steps.map((_, index) => `(SELECT COUNT(DISTINCT subject_id)::integer FROM step_${index + 1}) AS step_${index + 1}_count`),
  ].join(', ')
  return `WITH scoped_events AS (
    SELECT id, client_instance_id, client_sequence, name, visitor_id, business_user_id, occurred_at
    FROM events
    WHERE tenant_id = $1 AND project_id = $2 AND occurred_at >= $3 AND occurred_at < $4
      AND name = ANY($5::text[])
  ), subject_events AS (
    ${source}
  ), ${steps}
  SELECT ${counts}`
}

function stepCte(number: number): string {
  const nameParameter = number + 5
  if (number === 1) {
    return `step_1 AS (
      SELECT id, subject_id, client_instance_id, client_sequence, occurred_at
      FROM subject_events WHERE name = $${nameParameter}
    )`
  }
  const previous = number - 1
  return `step_${number} AS (
    SELECT current.id, current.subject_id, current.client_instance_id, current.client_sequence, current.occurred_at
    FROM subject_events current
    JOIN step_${previous} previous ON previous.subject_id = current.subject_id
      AND (current.occurred_at > previous.occurred_at
        OR (current.occurred_at = previous.occurred_at
          AND current.client_instance_id = previous.client_instance_id
          AND current.client_sequence > previous.client_sequence))
    WHERE current.name = $${nameParameter}
  )`
}

function integer(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}
