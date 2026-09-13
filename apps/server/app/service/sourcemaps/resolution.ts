import { createHash } from 'node:crypto'
import { GREATEST_LOWER_BOUND, TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { DatabaseClient } from '../database/types'
import { PrivateSourceMapArtifactStore } from './artifacts'

export const SOURCE_MAP_RESOLVER_VERSION = 'trace-mapping-v1'
export type ResolutionReason = 'missing_release' | 'missing_artifact' | 'invalid_position' | 'mapping_unavailable'
export interface GeneratedErrorFrame { filename: string; function?: string; line?: number; column?: number; in_app?: boolean }
export interface ResolvedErrorFrame extends GeneratedErrorFrame { resolved: boolean; resolution_reason?: ResolutionReason; original?: { source: string; line: number; column: number; function?: string }; artifact?: { release: string; dist: string; path: string; map_sha256: string } }
interface ArtifactRow { id: string; release: string; dist: string; artifact_path: string; map_sha256: string; artifact_ref: string | null; mapping_byte_count: number | null }
interface CacheRow { original_source: string | null; original_line: number | null; original_column: number | null; function_name: string | null }

/** Resolves only after error access authorization. Mapping bytes are read from a private store and never enter a DTO or response. */
export class SourceMapResolver {
  private readonly parsed = new Map<string, TraceMap>()
  constructor(private readonly database: DatabaseClient, private readonly artifacts?: PrivateSourceMapArtifactStore) {}
  async resolve(scope: { tenantId: string; projectId: string }, release: string | null, dist: string | null, frames: readonly GeneratedErrorFrame[]): Promise<ResolvedErrorFrame[]> { return Promise.all(frames.map(frame => this.resolveFrame(scope, release, dist, frame))) }
  private async resolveFrame(scope: { tenantId: string; projectId: string }, release: string | null, dist: string | null, frame: GeneratedErrorFrame): Promise<ResolvedErrorFrame> {
    if (!release) return unresolved(frame, 'missing_release')
    if (!validPosition(frame)) return unresolved(frame, 'invalid_position')
    const artifact = await this.artifact(scope, release, dist ?? 'default', frame.filename)
    if (!artifact) return unresolved(frame, 'missing_artifact')
    const cached = await this.cached(scope, artifact, frame)
    if (cached) return resolved(frame, artifact, cached)
    try {
      const mapping = await this.mapping(artifact)
      if (!mapping) return unresolved(frame, 'mapping_unavailable', artifact)
      const position = originalPositionFor(mapping, { line: frame.line!, column: frame.column!, bias: GREATEST_LOWER_BOUND })
      const source = safeSource(position.source)
      if (!source || position.line == null || position.column == null || position.line < 1 || position.column < 0) return unresolved(frame, 'mapping_unavailable', artifact)
      const value: CacheRow = { original_source: source, original_line: position.line, original_column: position.column, function_name: safeFunction(position.name) }
      await this.store(scope, artifact, frame, value)
      return resolved(frame, artifact, value)
    } catch { return unresolved(frame, 'mapping_unavailable', artifact) }
  }
  private async artifact(scope: { tenantId: string; projectId: string }, release: string, dist: string, path: string): Promise<ArtifactRow | null> {
    const result = await this.database.query<ArtifactRow>(`SELECT id, release, dist, artifact_path, map_sha256, artifact_ref, mapping_byte_count FROM source_map_artifacts WHERE tenant_id=$1 AND project_id=$2 AND release=$3 AND dist=$4 AND artifact_path=$5 AND superseded_at IS NULL LIMIT 1`, [ scope.tenantId, scope.projectId, release, dist, path ])
    return result.rows[0] ?? null
  }
  private async cached(scope: { tenantId: string; projectId: string }, artifact: ArtifactRow, frame: GeneratedErrorFrame): Promise<CacheRow | null> {
    const result = await this.database.query<CacheRow>(`SELECT original_source, original_line, original_column, function_name FROM source_map_resolutions WHERE tenant_id=$1 AND project_id=$2 AND artifact_id=$3 AND generated_filename=$4 AND generated_line=$5 AND generated_column=$6 AND resolver_version=$7`, [ scope.tenantId, scope.projectId, artifact.id, frame.filename, frame.line, frame.column, SOURCE_MAP_RESOLVER_VERSION ])
    return result.rows[0] ?? null
  }
  private async store(scope: { tenantId: string; projectId: string }, artifact: ArtifactRow, frame: GeneratedErrorFrame, value: CacheRow): Promise<void> {
    await this.database.query(`INSERT INTO source_map_resolutions (tenant_id,project_id,artifact_id,generated_filename,generated_line,generated_column,original_source,original_line,original_column,function_name,resolver_version,resolved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()) ON CONFLICT (tenant_id,project_id,artifact_id,generated_filename,generated_line,generated_column,resolver_version) DO NOTHING`, [ scope.tenantId, scope.projectId, artifact.id, frame.filename, frame.line, frame.column, value.original_source, value.original_line, value.original_column, value.function_name, SOURCE_MAP_RESOLVER_VERSION ])
  }
  private async mapping(artifact: ArtifactRow): Promise<TraceMap | null> {
    const byteCount = artifact.mapping_byte_count
    if (byteCount === null || !this.artifacts || !artifact.artifact_ref || !Number.isSafeInteger(byteCount) || byteCount < 1 || byteCount > 5 * 1024 * 1024) return null
    const key = `${artifact.id}:${artifact.map_sha256}`
    const prior = this.parsed.get(key); if (prior) return prior
    const contents = await this.artifacts.read(artifact.artifact_ref)
    if (!contents || contents.length !== byteCount || createHash('sha256').update(contents).digest('hex') !== artifact.map_sha256) return null
    const created = new TraceMap(contents.toString('utf8'))
    this.parsed.set(key, created)
    if (this.parsed.size > 128) this.parsed.delete(this.parsed.keys().next().value as string)
    return created
  }
}
export function normalizeGeneratedFilename(value: unknown): string | null { if (typeof value !== 'string' || value.length < 1 || value.length > 2048 || /[\u0000-\u001f\u007f?#\\]/.test(value)) return null; if (!value.startsWith('/') || value.includes('..') || value.includes('//')) return null; return value }
export function normalizeErrorFrame(value: unknown): GeneratedErrorFrame | null { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null; const input = value as Record<string, unknown>; if (Object.keys(input).some(key => !['filename', 'function', 'line', 'column', 'in_app'].includes(key))) return null; const filename = normalizeGeneratedFilename(input.filename); if (!filename) return null; const fn = safeFunction(input.function); if (input.function !== undefined && !fn) return null; const line = positiveInteger(input.line); const column = nonNegativeInteger(input.column); if (input.line !== undefined && line === null) return null; if (input.column !== undefined && column === null) return null; if (input.in_app !== undefined && typeof input.in_app !== 'boolean') return null; return { filename, ...(fn ? { function: fn } : {}), ...(line !== null ? { line } : {}), ...(column !== null ? { column } : {}), ...(typeof input.in_app === 'boolean' ? { in_app: input.in_app } : {}) } }
export function framesFromStack(stack: string | undefined): GeneratedErrorFrame[] { if (!stack) return []; const frames: GeneratedErrorFrame[] = []; for (const raw of stack.split('\n').slice(0, 80)) { const match = /(?:at\s+(?:(.*?)\s+\()?)?((?:https?:\/\/[^/]+)?\/[^\s()]+):(\d+):(\d+)\)?$/.exec(raw.trim()); if (!match) continue; let filename = match[2]!; if (/^https?:\/\//.test(filename)) { try { filename = new URL(filename).pathname } catch { continue } }; const frame = normalizeErrorFrame({ filename, function: match[1]?.trim() || undefined, line: Number(match[3]), column: Number(match[4]), in_app: true }); if (frame) frames.push(frame); if (frames.length === 40) break }; return frames }
function validPosition(frame: GeneratedErrorFrame): frame is GeneratedErrorFrame & { line: number; column: number } { return typeof frame.line === 'number' && typeof frame.column === 'number' }
function positiveInteger(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 10_000_000 ? value : null }
function nonNegativeInteger(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000 ? value : null }
function safeFunction(value: unknown): string | null { return typeof value === 'string' && value.length >= 1 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null }
function safeSource(value: unknown): string | null { if (typeof value !== 'string' || value.length < 1 || value.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(value) || /^(?:[A-Za-z]:|\/|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/.test(value)) return null; const parts: string[] = []; for (const part of value.split('/')) { if (!part || part === '.') continue; if (part === '..') { parts.pop(); continue }; parts.push(part) }; return parts.length ? parts.join('/') : null }
function unresolved(frame: GeneratedErrorFrame, reason: ResolutionReason, artifact?: ArtifactRow): ResolvedErrorFrame { return { ...frame, resolved: false, resolution_reason: reason, ...(artifact ? { artifact: safeArtifact(artifact) } : {}) } }
function resolved(frame: GeneratedErrorFrame, artifact: ArtifactRow, value: CacheRow): ResolvedErrorFrame { if (!value.original_source || value.original_line === null || value.original_column === null) return unresolved(frame, 'mapping_unavailable', artifact); return { ...frame, resolved: true, artifact: safeArtifact(artifact), original: { source: value.original_source, line: Number(value.original_line), column: Number(value.original_column), ...(value.function_name ? { function: value.function_name } : {}) } } }
function safeArtifact(artifact: ArtifactRow) { return { release: artifact.release, dist: artifact.dist, path: artifact.artifact_path, map_sha256: artifact.map_sha256 } }
