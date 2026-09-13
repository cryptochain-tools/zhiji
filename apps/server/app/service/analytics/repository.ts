import { DatabaseClient } from '../database/types'
import { AnalyticsEventWrite, DashboardQuery, EventsQuery, TrendPoint, TrendQuery } from './contracts'

export class AnalyticsRepository {
  constructor(private readonly database: DatabaseClient) {}

  async insertEvent(input: AnalyticsEventWrite): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO events
       (id, tenant_id, project_id, client_event_id, client_instance_id, client_sequence, name, visitor_id, business_user_id, url, route, browser, device, release, properties, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16)
       ON CONFLICT (tenant_id, project_id, client_event_id) DO NOTHING`,
      [ input.id, input.tenantId, input.projectId, input.clientEventId, input.clientInstanceId, input.clientSequence,
        input.name, input.visitorId, input.businessUserId ?? null, input.url ?? null, input.route ?? null,
        JSON.stringify(input.browser ?? {}), JSON.stringify(input.device ?? {}), input.release ?? null,
        JSON.stringify(input.properties ?? {}), input.occurredAt ],
    )
    return result.rowCount === 1
  }

  async trend(query: TrendQuery): Promise<TrendPoint[]> {
    const bucket = query.granularity === 'hour' ? 'hour' : 'day'
    const result = await this.database.query<TrendPoint>(
      `SELECT date_trunc($4, occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS bucket_start,
              name AS event_name, COUNT(*)::integer AS event_count,
              COUNT(*) FILTER (WHERE name = 'page_view')::integer AS page_views,
              COUNT(DISTINCT visitor_id)::integer AS visitors
       FROM events
       WHERE tenant_id = $1 AND project_id = $2 AND occurred_at >= $3 AND occurred_at < $5
         AND name = ANY($6::text[])
       GROUP BY bucket_start, name
       ORDER BY bucket_start ASC, name ASC`,
      [ query.tenantId, query.projectId, query.from, bucket, query.to, query.eventNames ],
    )
    return result.rows
  }

  async dashboard(query: DashboardQuery): Promise<{ summary: { pv: number; visitors: number; business_users: number; event_count: number; unresolved_errors: number }; points: TrendPoint[]; errors: Array<{ id: string; title: string; occurrence_count: number; last_seen: Date }> }> {
    const bucket = query.granularity === 'hour' ? 'hour' : 'day'
    const [summary, points, errors] = await Promise.all([
      this.database.query<{ pv: number; visitors: number; business_users: number; event_count: number; unresolved_errors: number }>(
        `SELECT COUNT(*) FILTER (WHERE name='page_view')::integer AS pv, COUNT(DISTINCT visitor_id)::integer AS visitors,
                COUNT(DISTINCT business_user_id)::integer AS business_users, COUNT(*)::integer AS event_count,
                (SELECT COUNT(*)::integer FROM error_groups WHERE tenant_id=$1 AND project_id=$2 AND status='unresolved') AS unresolved_errors
         FROM events WHERE tenant_id=$1 AND project_id=$2 AND occurred_at >= $3 AND occurred_at < $4`,
        [ query.tenantId, query.projectId, query.from, query.to ],
      ),
      this.database.query<TrendPoint>(
        `SELECT date_trunc($4, occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS bucket_start, name AS event_name,
                COUNT(*)::integer AS event_count, COUNT(*) FILTER (WHERE name='page_view')::integer AS page_views, COUNT(DISTINCT visitor_id)::integer AS visitors
         FROM events WHERE tenant_id=$1 AND project_id=$2 AND occurred_at >= $3 AND occurred_at < $5
           AND (name='page_view' OR name IN (SELECT jsonb_array_elements_text(core_event_names) FROM projects WHERE tenant_id=$1 AND id=$2))
         GROUP BY bucket_start,name ORDER BY bucket_start ASC,name ASC`,
        [ query.tenantId, query.projectId, query.from, bucket, query.to ],
      ),
      this.database.query<{ id: string; title: string; occurrence_count: number; last_seen: Date }>(
        `SELECT id, type || ': ' || display_message AS title, occurrence_count::integer, last_seen
         FROM error_groups WHERE tenant_id=$1 AND project_id=$2 AND status='unresolved'
         ORDER BY last_seen DESC,id DESC LIMIT 10`, [ query.tenantId, query.projectId ],
      ),
    ])
    return { summary: summary.rows[0] ?? { pv: 0, visitors: 0, business_users: 0, event_count: 0, unresolved_errors: 0 }, points: points.rows, errors: errors.rows }
  }

  async events(query: EventsQuery): Promise<Array<{ value: string; count: number }>> {
    const values: unknown[] = [ query.tenantId, query.projectId, query.from, query.to ]
    const clauses = [ 'tenant_id=$1', 'project_id=$2', 'occurred_at >= $3', 'occurred_at < $4' ]
    if (query.name) { values.push(query.name); clauses.push(`name=$${values.length}`) }
    for (const filter of query.filters) { values.push(filter.key, JSON.stringify(filter.value)); clauses.push(`properties -> $${values.length - 1} = $${values.length}::jsonb`) }
    const expression = query.groupBy === 'route' ? "COALESCE(route, '(none)')" : query.groupBy === 'release' ? "COALESCE(release, '(none)')" : 'name'
    values.push(query.limit)
    const result = await this.database.query<{ value: string; count: number }>(
      `SELECT ${expression} AS value, COUNT(*)::integer AS count FROM events WHERE ${clauses.join(' AND ')}
       GROUP BY ${expression} ORDER BY count DESC,value ASC LIMIT $${values.length}`,
      values,
    )
    return result.rows
  }
}
