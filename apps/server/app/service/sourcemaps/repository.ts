import { createHash, randomUUID } from 'node:crypto'
import { SourceMapArtifact, SourceMapArtifactWrite, SourceMapKeyAuthorizer, SourceMapUploadScope } from '../../contracts/sourcemaps'
import { DatabaseClient, DatabasePool } from '../database/types'
import { PrivateSourceMapArtifactStore, SourceMapArtifactStoreUnavailableError } from './artifacts'

/** PostgreSQL metadata adapter. Sanitized mapping bytes never enter PostgreSQL. */
export class PostgresSourceMapRepository implements SourceMapKeyAuthorizer {
  constructor(private readonly database: DatabaseClient, private readonly artifactStore?: PrivateSourceMapArtifactStore) {}

  async authenticate(secret: string): Promise<SourceMapUploadScope | null> {
    const hash = createHash('sha256').update(secret, 'utf8').digest()
    const result = await this.database.query<{ id: string; tenant_id: string; project_id: string; disabled_at: Date | null }>(
      `SELECT keys.id, keys.tenant_id, keys.project_id, keys.disabled_at
       FROM project_keys AS keys
       INNER JOIN projects ON projects.tenant_id = keys.tenant_id AND projects.id = keys.project_id
       WHERE keys.key_hash = $1 AND keys.key_type = 'sourcemap_upload'
         AND projects.deletion_status = 'active'
       LIMIT 1`, [ hash ],
    )
    const row = result.rows[0]
    return row ? { keyId: row.id, tenantId: row.tenant_id, projectId: row.project_id, disabled: Boolean(row.disabled_at) } : null
  }

  async putIfAbsent(input: SourceMapArtifact): Promise<SourceMapArtifactWrite> {
    const store = this.requireArtifacts()
    const stored = await store.put({ artifactId: input.id, contents: Buffer.from(input.mappingBlob, 'utf8') })
    let keep = false
    try {
      const inserted = await this.database.query<ArtifactRow>(
        `INSERT INTO source_map_artifacts
         (id, tenant_id, project_id, release, dist, artifact_path, map_sha256, format_version, artifact_ref, mapping_byte_count, source_count, created_by_key_id, created_at, superseded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (tenant_id, project_id, release, dist, artifact_path) WHERE superseded_at IS NULL DO NOTHING
         RETURNING ${columns}`,
        values(input, stored),
      )
      if (inserted.rows[0]) {
        keep = true
        return { status: 'created', artifact: artifact(inserted.rows[0], input.mappingBlob) }
      }
      const existing = await this.database.query<ArtifactRow>(
        `SELECT ${columns} FROM source_map_artifacts
         WHERE tenant_id = $1 AND project_id = $2 AND release = $3 AND dist = $4 AND artifact_path = $5 AND superseded_at IS NULL`,
        [ input.tenantId, input.projectId, input.release, input.dist, input.artifactPath ],
      )
      const row = existing.rows[0]
      if (!row) throw new Error('Source Map artifact disappeared after conflict')
      if (row.map_sha256 !== input.mapSha256) return { status: 'conflict' }
      // `030` intentionally removes old database blobs. A trusted CI retry of
      // the identical sanitized map repairs that historic metadata in place.
      if (!row.artifact_ref || row.mapping_byte_count === null) {
        const repaired = await this.database.query<ArtifactRow>(
          `UPDATE source_map_artifacts SET artifact_ref=$4, mapping_byte_count=$5
           WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND artifact_ref IS NULL
           RETURNING ${columns}`,
          [ input.tenantId, input.projectId, row.id, stored.ref, stored.byteCount ],
        )
        if (repaired.rows[0]) { keep = true; return { status: 'idempotent', artifact: artifact(repaired.rows[0], input.mappingBlob) } }
        throw new Error('Source Map artifact changed while repairing private storage')
      }
      return { status: 'idempotent', artifact: artifact(row, input.mappingBlob) }
    } finally {
      // A successful metadata row owns the object. Every conflict, idempotent
      // retry, and database error removes the tentative private object.
      if (!keep) await store.remove(stored.ref)
    }
  }

  /** Explicit CAS replacement for trusted CI only. */
  async supersede(input: SourceMapArtifact, expectedMapSha256: string): Promise<SourceMapArtifactWrite> {
    const pool = this.database as DatabasePool
    if (!pool.transaction) throw new Error('Source Map supersede requires a transactional database')
    const store = this.requireArtifacts()
    const stored = await store.put({ artifactId: input.id, contents: Buffer.from(input.mappingBlob, 'utf8') })
    let keep = false
    try {
      const result = await pool.transaction(async tx => {
        const current = await tx.query<ArtifactRow>(
          `SELECT ${columns} FROM source_map_artifacts
           WHERE tenant_id=$1 AND project_id=$2 AND release=$3 AND dist=$4 AND artifact_path=$5 AND superseded_at IS NULL FOR UPDATE`,
          [ input.tenantId, input.projectId, input.release, input.dist, input.artifactPath ],
        )
        const existing = current.rows[0]
        if (!existing) return { status: 'conflict' } as SourceMapArtifactWrite
        if (existing.map_sha256 === input.mapSha256) return { status: 'idempotent', artifact: artifact(existing, input.mappingBlob) } as SourceMapArtifactWrite
        if (existing.map_sha256 !== expectedMapSha256) return { status: 'conflict' } as SourceMapArtifactWrite
        const retired = await tx.query(
          `UPDATE source_map_artifacts SET superseded_at=$4
           WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND superseded_at IS NULL`,
          [ input.tenantId, input.projectId, existing.id, input.createdAt ],
        )
        if (retired.rowCount !== 1) return { status: 'conflict' } as SourceMapArtifactWrite
        const inserted = await tx.query<ArtifactRow>(
          `INSERT INTO source_map_artifacts
           (id,tenant_id,project_id,release,dist,artifact_path,map_sha256,format_version,artifact_ref,mapping_byte_count,source_count,created_by_key_id,created_at,superseded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL) RETURNING ${columns}`,
          values(input, stored).slice(0, 13),
        )
        const replacement = inserted.rows[0]
        if (!replacement) throw new Error('Source Map replacement did not persist')
        await tx.query(
          `INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,request_id,metadata)
           VALUES ($1,$2,NULL,'sourcemap_artifact_superseded_ci','source_map_artifact',$3,NULL,$4::jsonb)`,
          [ randomUUID(), input.tenantId, existing.id, JSON.stringify({ replacement_artifact_id: replacement.id, previous_map_sha256: existing.map_sha256, map_sha256: replacement.map_sha256, key_id: input.createdByKeyId }) ],
        )
        return { status: 'created', artifact: artifact(replacement, input.mappingBlob) } as SourceMapArtifactWrite
      })
      keep = result.status === 'created'
      return result
    } finally { if (!keep) await store.remove(stored.ref) }
  }
  private requireArtifacts(): PrivateSourceMapArtifactStore { if (!this.artifactStore) throw new SourceMapArtifactStoreUnavailableError(); return this.artifactStore }
}

interface ArtifactRow {
  id: string; tenant_id: string; project_id: string; release: string; dist: string; artifact_path: string
  map_sha256: string; format_version: 3; artifact_ref: string | null; mapping_byte_count: number | null; source_count: number; created_by_key_id: string; created_at: Date; superseded_at: Date | null
}
const columns = 'id, tenant_id, project_id, release, dist, artifact_path, map_sha256, format_version, artifact_ref, mapping_byte_count, source_count, created_by_key_id, created_at, superseded_at'
function values(input: SourceMapArtifact, stored: { ref: string; byteCount: number }): readonly unknown[] {
  return [ input.id, input.tenantId, input.projectId, input.release, input.dist, input.artifactPath, input.mapSha256,
    input.formatVersion, stored.ref, stored.byteCount, input.sourceCount, input.createdByKeyId, input.createdAt, input.supersededAt ?? null ]
}
function artifact(row: ArtifactRow, mappingBlob: string): SourceMapArtifact {
  return { id: row.id, tenantId: row.tenant_id, projectId: row.project_id, release: row.release, dist: row.dist,
    artifactPath: row.artifact_path, mapSha256: row.map_sha256, formatVersion: row.format_version, mappingBlob,
    sourceCount: row.source_count, createdByKeyId: row.created_by_key_id, createdAt: row.created_at, supersededAt: row.superseded_at }
}
