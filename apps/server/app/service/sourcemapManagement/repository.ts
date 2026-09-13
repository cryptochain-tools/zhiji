import { randomUUID } from 'node:crypto'
import { DatabasePool } from '../database/types'
import { SourceMapManagementScope, SourceMapMetadataRow } from './contracts'
import { PrivateSourceMapArtifactStore, SourceMapArtifactStoreUnavailableError } from '../sourcemaps/artifacts'

/** Management reads only safe metadata; mapping_blob is deliberately absent. */
export class SourceMapManagementRepository {
  constructor(private readonly database: DatabasePool, private readonly artifacts?: PrivateSourceMapArtifactStore) {}

  async list(scope: SourceMapManagementScope): Promise<SourceMapMetadataRow[]> {
    const result = await this.database.query<SourceMapMetadataRow>(
      `SELECT id, release, dist, artifact_path, map_sha256, format_version, source_count, created_at, superseded_at
       FROM source_map_artifacts WHERE tenant_id=$1 AND project_id=$2
       ORDER BY superseded_at NULLS FIRST, created_at DESC, id DESC LIMIT 500`, [ scope.tenantId, scope.projectId ],
    )
    return result.rows
  }

  async supersede(input: {
    scope: SourceMapManagementScope; artifactId: string; expectedMapSha256: string; actorUserId: string; requestId?: string
    mapSha256: string; mappingBlob: string; sourceCount: number; now: Date
  }): Promise<SourceMapMetadataRow | null> {
    const replacementId = randomUUID()
    const artifacts = this.requireArtifacts()
    const stored = await artifacts.put({ artifactId: replacementId, contents: Buffer.from(input.mappingBlob, 'utf8') })
    let keep = false
    try { return await this.database.transaction(async tx => {
      const current = await tx.query<{ id: string; release: string; dist: string; artifact_path: string; map_sha256: string }>(
        `SELECT id, release, dist, artifact_path, map_sha256 FROM source_map_artifacts
         WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND superseded_at IS NULL FOR UPDATE`,
        [ input.scope.tenantId, input.scope.projectId, input.artifactId ],
      )
      const artifact = current.rows[0]
      if (!artifact || artifact.map_sha256 !== input.expectedMapSha256) return null
      if (artifact.map_sha256 === input.mapSha256) return null
      const retired = await tx.query(
        `UPDATE source_map_artifacts SET superseded_at=$4 WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND superseded_at IS NULL`,
        [ input.scope.tenantId, input.scope.projectId, input.artifactId, input.now ],
      )
      if (retired.rowCount !== 1) return null
      const inserted = await tx.query<SourceMapMetadataRow>(
        `INSERT INTO source_map_artifacts
         (id,tenant_id,project_id,release,dist,artifact_path,map_sha256,format_version,artifact_ref,mapping_byte_count,source_count,created_by_key_id,created_at,superseded_at)
         SELECT $4,$1,$2,release,dist,artifact_path,$5,3,$6,$7,$8,created_by_key_id,$9,NULL
         FROM source_map_artifacts WHERE tenant_id=$1 AND project_id=$2 AND id=$3
         RETURNING id, release, dist, artifact_path, map_sha256, format_version, source_count, created_at, superseded_at`,
        [ input.scope.tenantId, input.scope.projectId, input.artifactId, replacementId, input.mapSha256, stored.ref, stored.byteCount, input.sourceCount, input.now ],
      )
      const replacement = inserted.rows[0]
      if (!replacement) throw new Error('Source Map replacement did not persist')
      await tx.query(
        `INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,request_id,metadata)
         VALUES ($1,$2,$3,'sourcemap_artifact_superseded','source_map_artifact',$4,$5,$6::jsonb)`,
        [ randomUUID(), input.scope.tenantId, input.actorUserId, input.artifactId, input.requestId ?? null,
          JSON.stringify({ replacement_artifact_id: replacement.id, previous_map_sha256: artifact.map_sha256, map_sha256: replacement.map_sha256 }) ],
      )
      keep = true
      return replacement
    }) } finally { if (!keep) await artifacts.remove(stored.ref) }
  }
  private requireArtifacts(): PrivateSourceMapArtifactStore { if (!this.artifacts) throw new SourceMapArtifactStoreUnavailableError(); return this.artifacts }
}
