import { DatabaseClient } from '../database/types'
import { PrivateSourceMapArtifactStore, SourceMapArtifactStoreUnavailableError } from './artifacts'

const DAY = 24 * 60 * 60 * 1000
const BATCH_SIZE = 500

/**
 * A map remains available while error occurrences for its release remain in
 * scope. The object is removed first; metadata is deleted only after the
 * private-store removal succeeds, so a failed cleanup can safely retry.
 */
export async function cleanupExpiredSourceMaps(database: DatabaseClient, artifacts: PrivateSourceMapArtifactStore | undefined, input: { tenantId: string; projectId: string; now?: Date; errorOccurrenceDays?: number }): Promise<number> {
  if (!artifacts) throw new SourceMapArtifactStoreUnavailableError()
  const now = input.now ?? new Date()
  const days = input.errorOccurrenceDays ?? 90
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw new Error('invalid_sourcemap_retention_days')
  const cutoff = new Date(now.getTime() - days * DAY)
  const candidates = await database.query<{ id: string; artifact_ref: string | null }>(
    `SELECT artifacts.id, artifacts.artifact_ref FROM source_map_artifacts AS artifacts
     WHERE artifacts.tenant_id=$1 AND artifacts.project_id=$2 AND artifacts.created_at < $3
       AND NOT EXISTS (
         SELECT 1 FROM error_occurrences AS occurrences
         WHERE occurrences.tenant_id=artifacts.tenant_id AND occurrences.project_id=artifacts.project_id
           AND occurrences.release=artifacts.release AND occurrences.occurred_at >= $3
       )
     ORDER BY artifacts.created_at ASC, artifacts.id ASC LIMIT $4`,
    [ input.tenantId, input.projectId, cutoff, BATCH_SIZE ],
  )
  let removed = 0
  for (const candidate of candidates.rows) {
    // Legacy rows from the one-time schema migration have no map bytes. They
    // are safe to remove only once no associated raw occurrence is retained.
    if (candidate.artifact_ref) await artifacts.remove(candidate.artifact_ref)
    const result = await database.query(
      `DELETE FROM source_map_artifacts
       WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND artifact_ref IS NOT DISTINCT FROM $4`,
      [ candidate.id, input.tenantId, input.projectId, candidate.artifact_ref ],
    )
    removed += result.rowCount ?? 0
  }
  return removed
}
