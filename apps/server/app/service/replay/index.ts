import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { ReplayListQuery, ReplayScope, parseReplayChunkQuery, parseReplayListQuery } from './contracts'
import { ReplayRepository } from './repository'
import { PrivateReplayArtifactStore } from './artifacts'
import { validateSanitizedReplayChunk } from './sanitize'

export default class ReplayService extends Service {
  private artifacts(): PrivateReplayArtifactStore { const store = this.config.zhiji.replayArtifactStore; if (!store) throw httpError(503, 'replay_artifact_store_unavailable', 'Replay storage is unavailable'); return store }
  private repository(): ReplayRepository { if (!this.config.zhiji.database.configured) throw httpError(503, 'replay_unavailable', 'Replay is unavailable'); return new ReplayRepository(this.config.zhiji.database) }
  async list(scope: ReplayScope, raw: unknown) {
    const query = parseReplayListQuery(raw); const rows = await this.repository().list(scope, query); const items = rows.slice(0, query.limit).map(metadata)
    const last = rows[query.limit - 1]; return { items, next_cursor: rows.length > query.limit && last ? `${last.started_at.getTime()}.${last.id}` : null }
  }
  async detail(scope: ReplayScope, id: string) { const row = await this.repository().session(scope, id); if (!row) throw httpError(404, 'replay_not_found', 'Replay session was not found'); return metadata(row) }
  async chunks(scope: ReplayScope, id: string, raw: unknown) {
    if (!await this.repository().session(scope, id)) throw httpError(404, 'replay_not_found', 'Replay session was not found')
    const store = this.artifacts()
    const rows = await this.repository().chunks(scope, id, parseReplayChunkQuery(raw))
    const items = []
    for (const row of rows) {
      // References are fetched only after the tenant/project/session scope is
      // checked. The response exposes a validated timeline, never a storage URL.
      const contents = await store.read(row.artifact_ref)
      if (!contents) throw httpError(410, 'replay_artifact_expired', 'Replay chunk is no longer available')
      if (contents.length !== Number(row.artifact_byte_count)) throw httpError(500, 'replay_artifact_invalid', 'Replay chunk failed integrity verification')
      const data = contents.toString('base64')
      try { validateSanitizedReplayChunk({ encoding: row.encoding, data, sha256: row.payload_sha256 }) } catch { throw httpError(500, 'replay_artifact_invalid', 'Replay chunk failed integrity verification') }
      items.push({ client_event_id: row.client_event_id, sequence_start: Number(row.sequence_start), sequence_end: Number(row.sequence_end), encoding: row.encoding, occurred_from: row.occurred_from.toISOString(), occurred_to: row.occurred_to.toISOString(), timeline: JSON.parse(contents.toString('utf8')) })
    }
    return { items }
  }
}

function metadata(row: { id: string; visitor_id: string; business_user_id: string | null; started_at: Date; release: string | null; policy_version: number; initial_route: string; sample_decision: boolean; received_at: Date; chunk_count: number }) { return { id: row.id, visitor_id: row.visitor_id, business_user_id: row.business_user_id, started_at: row.started_at.toISOString(), release: row.release, policy_version: row.policy_version, initial_route: row.initial_route, sample_decision: row.sample_decision, received_at: row.received_at.toISOString(), chunk_count: Number(row.chunk_count) } }
export { ReplayScope, ReplayListQuery }
