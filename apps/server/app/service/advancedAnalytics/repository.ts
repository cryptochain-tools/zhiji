import { DatabaseClient } from '../database/types'
import { PathQuery, RetentionQuery } from './contracts'

interface Row extends Record<string, unknown> {}
export interface RetentionRow { cohortBucket: Date; cohortSize: number; retained: number[] }
export interface PathRow { depth: number; parentPath: string[]; name: string; count: number }

export class AdvancedAnalyticsRepository {
  constructor(private readonly database: DatabaseClient) {}

  async retention(query: RetentionQuery): Promise<{ rows: RetentionRow[]; sourceEventCount: number }> {
    const result = await this.database.query<Row>(retentionSql(query), retentionValues(query))
    return {
      rows: result.rows.map(row => ({
        cohortBucket: date(row.cohort_bucket), cohortSize: integer(row.cohort_size),
        retained: Array.from({ length: query.periodCount }, (_, index) => integer(row[`retained_${index + 1}`])),
      })),
      sourceEventCount: integer(result.rows[0]?.source_event_count),
    }
  }

  async path(query: PathQuery): Promise<{ rows: PathRow[]; sourceEventCount: number }> {
    const result = await this.database.query<Row>(pathSql(query), pathValues(query))
    return {
      rows: result.rows.filter(row => typeof row.name === 'string').map(row => ({
        depth: integer(row.depth), parentPath: stringArray(row.parent_path), name: row.name as string, count: integer(row.subject_count),
      })),
      sourceEventCount: integer(result.rows[0]?.source_event_count),
    }
  }
}

function retentionValues(query: RetentionQuery): readonly unknown[] { return [ query.tenantId, query.projectId, query.from, query.to, query.timezone, query.startEvent, query.returnEvent ] }
function retentionSql(query: RetentionQuery): string {
  const subjectEvents = query.subjectKind === 'visitor'
    ? `SELECT id, name, occurred_at, visitor_id AS subject_id FROM scoped_events`
    : `SELECT DISTINCT e.id, e.name, e.occurred_at, i.business_user_id AS subject_id
       FROM scoped_events e JOIN identities i ON i.tenant_id = $1 AND i.project_id = $2 AND i.visitor_id = e.visitor_id`
  const retained = Array.from({ length: query.periodCount }, (_, index) => {
    const number = index + 1
    return `COUNT(DISTINCT r${number}.subject_id)::integer AS retained_${number}`
  }).join(', ')
  const joins = Array.from({ length: query.periodCount }, (_, index) => {
    const number = index + 1
    return `LEFT JOIN return_subjects r${number} ON r${number}.subject_id = s.subject_id
      AND r${number}.period_bucket = s.cohort_bucket + interval '${number} ${query.period}'`
  }).join('\n')
  return `WITH scoped_events AS (
    SELECT id, name, visitor_id, occurred_at FROM events
    WHERE tenant_id = $1 AND project_id = $2 AND occurred_at >= $3 AND occurred_at < $4 AND name = ANY(ARRAY[$6::text, $7::text])
  ), subject_events AS (${subjectEvents}), start_subjects AS (
    SELECT DISTINCT subject_id, date_trunc('${query.period}', occurred_at AT TIME ZONE $5) AS cohort_bucket
    FROM subject_events WHERE name = $6
  ), return_subjects AS (
    SELECT DISTINCT subject_id, date_trunc('${query.period}', occurred_at AT TIME ZONE $5) AS period_bucket
    FROM subject_events WHERE name = $7
  ), source AS (SELECT COUNT(*)::integer AS source_event_count FROM scoped_events)
  SELECT s.cohort_bucket AT TIME ZONE $5 AS cohort_bucket, COUNT(DISTINCT s.subject_id)::integer AS cohort_size,
         ${retained}, (SELECT source_event_count FROM source) AS source_event_count
  FROM start_subjects s
  ${joins}
  GROUP BY s.cohort_bucket
  ORDER BY s.cohort_bucket ASC`
}

function pathValues(query: PathQuery): readonly unknown[] { return [ query.tenantId, query.projectId, query.from, query.to, query.startEvent, query.depth ] }
function pathSql(query: PathQuery): string {
  const subjectEvents = query.subjectKind === 'visitor'
    ? `SELECT id, client_instance_id, client_sequence, name, route, occurred_at, visitor_id AS subject_id FROM scoped_events`
    : `SELECT DISTINCT e.id, e.client_instance_id, e.client_sequence, e.name, e.route, e.occurred_at, i.business_user_id AS subject_id
       FROM scoped_events e JOIN identities i ON i.tenant_id = $1 AND i.project_id = $2 AND i.visitor_id = e.visitor_id`
  return `WITH RECURSIVE scoped_events AS (
    SELECT id, client_instance_id, client_sequence, name, route, occurred_at, visitor_id
    FROM events WHERE tenant_id = $1 AND project_id = $2 AND occurred_at >= $3 AND occurred_at < $4
  ), subject_events AS (${subjectEvents}), starts AS (
    SELECT DISTINCT ON (subject_id) subject_id, id, client_instance_id, client_sequence, name,
      CASE WHEN name = 'page_view' THEN COALESCE(NULLIF(route, ''), name) ELSE name END AS label, occurred_at
    FROM subject_events WHERE name = $5
    ORDER BY subject_id, occurred_at ASC, client_instance_id ASC, client_sequence ASC, id ASC
  ), paths AS (
    SELECT subject_id, id, client_instance_id, client_sequence, name, label, occurred_at, 1 AS depth, ARRAY[label]::text[] AS labels
    FROM starts
    UNION ALL
    SELECT p.subject_id, next.id, next.client_instance_id, next.client_sequence, next.name,
      next.label, next.occurred_at, p.depth + 1, p.labels || next.label
    FROM paths p
    JOIN LATERAL (
      SELECT e.id, e.client_instance_id, e.client_sequence, e.name, e.occurred_at,
        CASE WHEN e.name = 'page_view' THEN COALESCE(NULLIF(e.route, ''), e.name) ELSE e.name END AS label
      FROM subject_events e
      WHERE e.subject_id = p.subject_id AND e.name <> 'login' AND e.name <> p.name
        AND (e.occurred_at > p.occurred_at OR (e.occurred_at = p.occurred_at AND
          (e.client_instance_id > p.client_instance_id OR (e.client_instance_id = p.client_instance_id AND
            (e.client_sequence > p.client_sequence OR (e.client_sequence = p.client_sequence AND e.id > p.id))))))
      ORDER BY e.occurred_at ASC, e.client_instance_id ASC, e.client_sequence ASC, e.id ASC LIMIT 1
    ) next ON true
    WHERE p.depth < $6::integer
  ), source AS (SELECT COUNT(*)::integer AS source_event_count FROM scoped_events)
  SELECT depth, labels[1:depth-1] AS parent_path, label AS name, COUNT(DISTINCT subject_id)::integer AS subject_count,
    (SELECT source_event_count FROM source) AS source_event_count
  FROM paths WHERE depth > 1
  GROUP BY depth, parent_path, label
  ORDER BY depth ASC, parent_path ASC, subject_count DESC, label ASC`
}

function integer(value: unknown): number { const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0; return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0 }
function date(value: unknown): Date { const parsed = value instanceof Date ? value : new Date(typeof value === 'string' ? value : 0); return Number.isFinite(parsed.getTime()) ? parsed : new Date(0) }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [] }
