import { randomUUID } from 'node:crypto'
import { DatabaseClient } from '../database/types'
import { UserJourneyQuery, UserJourneyScope } from './contracts'

export interface UserDirectoryRow {
  business_user_id: string
  email_normalized: string
  display_name: string | null
  department: string | null
  role: string | null
  is_active: boolean
  last_seen_at: Date | null
  event_count: number | string
}

export interface UserJourneyRow {
  occurred_at: Date
  name: string
  route: string | null
  release: string | null
}

export class UserJourneysRepository {
  constructor(private readonly database: DatabaseClient) {}

  async directory(input: UserJourneyScope & { search: string; limit: number }): Promise<UserDirectoryRow[]> {
    const result = await this.database.query<UserDirectoryRow>(
      `WITH matching_profiles AS (
         SELECT profile.tenant_id, profile.project_id, profile.business_user_id, profile.email_normalized, profile.display_name,
                profile.department, profile.role, profile.is_active
         FROM business_user_profiles profile
         WHERE profile.tenant_id = $1 AND profile.project_id = $2
           AND ($3 = '' OR profile.email_normalized ILIKE '%' || $3 || '%' OR COALESCE(profile.display_name, '') ILIKE '%' || $3 || '%' OR profile.business_user_id ILIKE '%' || $3 || '%')
       ), activity AS (
         SELECT identity.business_user_id, MAX(event.occurred_at) AS last_seen_at, COUNT(*)::bigint AS event_count
         FROM matching_profiles profile
         JOIN identities identity
           ON identity.tenant_id = profile.tenant_id AND identity.project_id = profile.project_id
          AND identity.business_user_id = profile.business_user_id
         JOIN events event
           ON event.tenant_id = identity.tenant_id AND event.project_id = identity.project_id
          AND event.visitor_id = identity.visitor_id
         GROUP BY identity.business_user_id
       )
       SELECT profile.business_user_id, profile.email_normalized, profile.display_name, profile.department, profile.role, profile.is_active,
              activity.last_seen_at, COALESCE(activity.event_count, 0)::bigint AS event_count
       FROM matching_profiles profile
       LEFT JOIN activity ON activity.business_user_id = profile.business_user_id
       ORDER BY activity.last_seen_at DESC NULLS LAST, profile.display_name ASC NULLS LAST, profile.business_user_id ASC
       LIMIT $4`,
      [ input.tenantId, input.projectId, input.search, input.limit ],
    )
    return result.rows
  }

  async profile(query: UserJourneyQuery): Promise<UserDirectoryRow | null> {
    const result = await this.database.query<UserDirectoryRow>(
      `SELECT profile.business_user_id, profile.email_normalized, profile.display_name, profile.department, profile.role, profile.is_active,
         NULL::timestamptz AS last_seen_at, 0::bigint AS event_count
       FROM business_user_profiles profile
       WHERE profile.tenant_id = $1 AND profile.project_id = $2 AND profile.business_user_id = $3`,
      [ query.tenantId, query.projectId, query.businessUserId ],
    )
    return result.rows[0] ?? null
  }

  async journey(query: UserJourneyQuery): Promise<UserJourneyRow[]> {
    const result = await this.database.query<UserJourneyRow>(
      `SELECT event.occurred_at, event.name,
         CASE WHEN event.name = 'page_view' OR RIGHT(event.name, 11) = '.page_enter' THEN event.route ELSE NULL END AS route,
         event.release
       FROM identities identity
       JOIN events event
         ON event.tenant_id = identity.tenant_id AND event.project_id = identity.project_id
        AND event.visitor_id = identity.visitor_id
       WHERE identity.tenant_id = $1 AND identity.project_id = $2 AND identity.business_user_id = $3
         AND event.occurred_at >= $4 AND event.occurred_at < $5
         AND event.name <> 'login'
       ORDER BY event.occurred_at DESC, event.client_instance_id DESC, event.client_sequence DESC, event.id DESC
       LIMIT $6`,
      [ query.tenantId, query.projectId, query.businessUserId, query.from, query.to, query.limit + 1 ],
    )
    return result.rows
  }

  async recordRead(query: UserJourneyQuery, actorUserId: string, requestId: string | undefined, returnedCount: number): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, target_type, target_id, request_id, metadata)
       VALUES ($1, $2, $3, 'business_user_journey_viewed', 'business_user', $4, $5,
         jsonb_build_object('project_id', $6::text, 'from', $7::timestamptz, 'to', $8::timestamptz, 'returned_count', $9::integer))`,
      [ randomUUID(), query.tenantId, actorUserId, query.businessUserId, requestId ?? null, query.projectId, query.from, query.to, returnedCount ],
    )
  }
}
