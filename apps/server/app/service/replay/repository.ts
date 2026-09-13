import { DatabaseClient } from '../database/types'
import { ReplayListQuery, ReplayScope } from './contracts'

interface SessionRow { id: string; visitor_id: string; business_user_id: string | null; started_at: Date; release: string | null; policy_version: number; initial_route: string; sample_decision: boolean; received_at: Date; chunk_count: number }
export interface ChunkRow { client_event_id: string; sequence_start: number; sequence_end: number; encoding: string; artifact_ref: string; artifact_byte_count: number; payload_sha256: string; occurred_from: Date; occurred_to: Date }

export class ReplayRepository {
  constructor(private readonly database: DatabaseClient) {}
  async list(scope: ReplayScope, query: ReplayListQuery): Promise<SessionRow[]> {
    const result = await this.database.query<SessionRow>(`SELECT s.id, s.visitor_id, s.business_user_id, s.started_at, s.release, s.policy_version, s.initial_route, s.sample_decision, s.received_at, count(c.id)::integer AS chunk_count
      FROM replay_sessions s LEFT JOIN replay_chunks c ON c.tenant_id = s.tenant_id AND c.project_id = s.project_id AND c.session_id = s.id
      WHERE s.tenant_id = $1 AND s.project_id = $2 AND s.started_at >= $3 AND s.started_at <= $4
        AND ($5::text IS NULL OR s.initial_route = $5) AND ($6::text IS NULL OR s.release = $6) AND ($7::text IS NULL OR s.visitor_id = $7)
        AND ($8::timestamptz IS NULL OR (s.started_at, s.id) < ($8, $9::uuid))
      GROUP BY s.id, s.visitor_id, s.business_user_id, s.started_at, s.release, s.policy_version, s.initial_route, s.sample_decision, s.received_at
      ORDER BY s.started_at DESC, s.id DESC LIMIT $10`, [ scope.tenantId, scope.projectId, query.from, query.to, query.route ?? null, query.release ?? null, query.visitorId ?? null, query.cursor?.startedAt ?? null, query.cursor?.id ?? null, query.limit + 1 ])
    return result.rows
  }
  async session(scope: ReplayScope, id: string): Promise<SessionRow | null> {
    const result = await this.database.query<SessionRow>(`SELECT s.id, s.visitor_id, s.business_user_id, s.started_at, s.release, s.policy_version, s.initial_route, s.sample_decision, s.received_at, count(c.id)::integer AS chunk_count
      FROM replay_sessions s LEFT JOIN replay_chunks c ON c.tenant_id=s.tenant_id AND c.project_id=s.project_id AND c.session_id=s.id WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.id=$3
      GROUP BY s.id, s.visitor_id, s.business_user_id, s.started_at, s.release, s.policy_version, s.initial_route, s.sample_decision, s.received_at`, [scope.tenantId, scope.projectId, id])
    return result.rows[0] ?? null
  }
  async chunks(scope: ReplayScope, id: string, range: { from?: Date; to?: Date }): Promise<ChunkRow[]> {
    const result = await this.database.query<ChunkRow>(`SELECT client_event_id, sequence_start, sequence_end, encoding, artifact_ref, artifact_byte_count, payload_sha256, occurred_from, occurred_to FROM replay_chunks
      WHERE tenant_id=$1 AND project_id=$2 AND session_id=$3 AND ($4::timestamptz IS NULL OR occurred_to >= $4) AND ($5::timestamptz IS NULL OR occurred_from <= $5)
      ORDER BY sequence_start ASC LIMIT 400`, [scope.tenantId, scope.projectId, id, range.from ?? null, range.to ?? null])
    return result.rows
  }
}
