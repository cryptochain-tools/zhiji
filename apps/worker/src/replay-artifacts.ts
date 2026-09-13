import { DatabaseClient } from '../../server/app/service/database/types'
import { PrivateReplayArtifactStore, ReplayArtifactStoreUnavailableError } from '../../server/app/service/replay/artifacts'

export interface ReplayArtifactScope { tenantId: string; projectId: string; sessionId?: string; businessUserId?: string }

interface Candidate { id: string; artifact_ref: string }

/**
 * Deletion order is intentionally object first, metadata second. `remove` is
 * idempotent, so a database failure leaves a harmless missing object that a
 * later cleanup can safely finish; the reverse order could leak content.
 */
export async function removeReplayArtifacts(database: DatabaseClient, artifacts: PrivateReplayArtifactStore | undefined, scope: ReplayArtifactScope, limit = 1_000): Promise<number> {
  const clauses = [ 'tenant_id = $1', 'project_id = $2' ]
  const values: unknown[] = [ scope.tenantId, scope.projectId ]
  if (scope.sessionId) { values.push(scope.sessionId); clauses.push(`session_id = $${values.length}`) }
  if (scope.businessUserId) {
    values.push(scope.businessUserId)
    clauses.push(`session_id IN (SELECT id FROM replay_sessions WHERE tenant_id = $1 AND project_id = $2 AND business_user_id = $${values.length})`)
  }
  values.push(limit)
  const candidates = await database.query<Candidate>(`SELECT id, artifact_ref FROM replay_chunks WHERE ${clauses.join(' AND ')} ORDER BY occurred_to ASC, id ASC LIMIT $${values.length}`, values)
  if (candidates.rows.length > 0 && !artifacts) throw new ReplayArtifactStoreUnavailableError()
  let removed = 0
  for (const candidate of candidates.rows) {
    await artifacts!.remove(candidate.artifact_ref)
    const result = await database.query('DELETE FROM replay_chunks WHERE id = $1 AND tenant_id = $2 AND project_id = $3 AND artifact_ref = $4', [ candidate.id, scope.tenantId, scope.projectId, candidate.artifact_ref ])
    removed += result.rowCount ?? 0
  }
  return removed
}
