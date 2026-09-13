import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { prepareSourceMapArtifact, SourceMapContractError } from '../sourcemaps'
import { SourceMapManagementScope, SourceMapMetadata, SourceMapMetadataRow } from './contracts'
import { SourceMapManagementRepository } from './repository'
import { sourceMapArtifactStoreFromConfig } from '../sourcemaps/artifacts'

export { SourceMapManagementScope }
export class SourceMapManagementService {
  constructor(private readonly repository: SourceMapManagementRepository, private readonly now: () => Date = () => new Date()) {}
  async list(scope: SourceMapManagementScope): Promise<{ items: SourceMapMetadata[] }> { return { items: (await this.repository.list(scope)).map(metadata) } }
  async supersede(scope: SourceMapManagementScope, actorUserId: string, artifactId: string, raw: unknown, requestId?: string): Promise<{ artifact: SourceMapMetadata }> {
    const body = objectValue(raw)
    const allowed = new Set([ 'expected_map_sha256', 'map', 'map_sha256' ])
    if (Object.keys(body).some(key => !allowed.has(key)) || typeof body.expected_map_sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(body.expected_map_sha256)) {
      throw httpError(400, 'invalid_sourcemap_supersede', 'Source Map supersede request is invalid')
    }
    let prepared
    try { prepared = prepareSourceMapArtifact({ release: 'placeholder', artifact_path: '/placeholder.js', map: body.map as string, map_sha256: body.map_sha256 as string | undefined }) }
    catch (error) {
      if (error instanceof SourceMapContractError) throw httpError(error.status, error.code, error.message)
      throw error
    }
    const replacement = await this.repository.supersede({ scope, artifactId, expectedMapSha256: body.expected_map_sha256, actorUserId, requestId,
      mapSha256: prepared.mapSha256, mappingBlob: prepared.mappingBlob, sourceCount: prepared.sourceCount, now: this.now() })
    if (!replacement) throw httpError(409, 'sourcemap_supersede_conflict', 'Source Map artifact cannot be superseded')
    return { artifact: metadata(replacement) }
  }
}
export default class SourceMapManagementEggService extends Service {
  private domain(): SourceMapManagementService { const database = this.config.zhiji.database; if (!database?.configured) throw httpError(503, 'sourcemap_management_unavailable', 'Source Map management is unavailable'); return new SourceMapManagementService(new SourceMapManagementRepository(database, sourceMapArtifactStoreFromConfig(this.config.zhiji.sourceMapArtifactStore))) }
  list(scope: SourceMapManagementScope) { return this.domain().list(scope) }
  supersede(scope: SourceMapManagementScope, actorUserId: string, artifactId: string, raw: unknown, requestId?: string) { return this.domain().supersede(scope, actorUserId, artifactId, raw, requestId) }
}
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function metadata(row: SourceMapMetadataRow): SourceMapMetadata { return { id: row.id, release: row.release, dist: row.dist, artifact_path: row.artifact_path, map_sha256: row.map_sha256, format_version: 3, source_count: Number(row.source_count), created_at: row.created_at.toISOString(), superseded_at: row.superseded_at?.toISOString() ?? null } }
