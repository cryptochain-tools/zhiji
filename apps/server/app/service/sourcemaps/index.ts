import { createHash, randomUUID } from 'node:crypto'
import { Service } from 'egg'
import {
  SourceMapArtifact,
  SourceMapArtifactStore,
  SourceMapArtifactWrite,
  SourceMapDependencies,
  SourceMapUploadRequest,
  SourceMapUploadResponse,
  PreparedSourceMapArtifact,
} from '../../contracts/sourcemaps'
import { httpError } from '../../lib/http'

const MAX_MAP_BYTES = 5 * 1024 * 1024
const MAX_SOURCES = 5_000
const MAX_NAMES = 50_000
const MAX_MAPPING_CHARS = 2_000_000
const MAX_MAPPING_LINES = 200_000
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/
const ABSOLUTE_LOCAL_PATH = /^(?:[A-Za-z]:[\\/]|[/\\]{1,2})/
const REMOTE_URL = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//

interface SourceMapV3 {
  version: 3
  sourceRoot?: string
  sources: string[]
  sourcesContent?: unknown
  names: string[]
  mappings: string
  sections?: unknown
  [key: string]: unknown
}

/** Used until a database-backed key and private object-store adapter is installed. */
const failClosedDependencies: SourceMapDependencies = {
  keys: { authenticate: async () => null },
  artifacts: {
    putIfAbsent: async () => {
      throw httpError(503, 'sourcemap_storage_unavailable', 'Source Map storage is unavailable')
    },
  },
}

export class SourceMapContractError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message)
  }
}

export function sourceMapDependenciesFromApp(app: unknown): SourceMapDependencies {
  const candidate = (app as { sourceMapDependencies?: SourceMapDependencies }).sourceMapDependencies
  return candidate ?? failClosedDependencies
}

export async function uploadSourceMap(
  request: SourceMapUploadRequest,
  dependencies: SourceMapDependencies = failClosedDependencies,
): Promise<SourceMapUploadResponse> {
  const key = request.key
  if (!isUploadKey(key)) throw contractError('invalid_sourcemap_key', 401, 'Source Map upload key is invalid')
  const scope = await dependencies.keys.authenticate(key)
  if (!scope) throw contractError('invalid_sourcemap_key', 401, 'Source Map upload key is invalid')
  if (scope.disabled) throw contractError('sourcemap_key_disabled', 403, 'Source Map upload key is disabled')

  const prepared = prepareSourceMapArtifact(request)

  const now = (dependencies.now ?? (() => new Date()))()
  const artifact: SourceMapArtifact = {
    id: (dependencies.createId ?? randomUUID)(),
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    release: prepared.release,
    dist: prepared.dist,
    artifactPath: prepared.artifactPath,
    mapSha256: prepared.mapSha256,
    formatVersion: 3,
    mappingBlob: prepared.mappingBlob,
    sourceCount: prepared.sourceCount,
    createdByKeyId: scope.keyId,
    createdAt: now,
  }
  const expectedMapSha256 = supersedeChecksum(request.supersede)
  const result = expectedMapSha256
    ? await supersedeFromCi(dependencies.artifacts, artifact, expectedMapSha256)
    : await dependencies.artifacts.putIfAbsent(artifact)
  if (result.status === 'conflict') {
    throw contractError('sourcemap_artifact_conflict', 409, 'A different Source Map artifact already exists for this release')
  }
  return publicArtifact(result.artifact)
}

async function supersedeFromCi(store: SourceMapArtifactStore, artifact: SourceMapArtifact, expectedMapSha256: string): Promise<SourceMapArtifactWrite> {
  if (!store.supersede) throw contractError('sourcemap_supersede_unavailable', 503, 'Source Map supersede is unavailable')
  return store.supersede(artifact, expectedMapSha256)
}

function supersedeChecksum(value: unknown): string | null {
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value as object).length !== 1 || !/^[a-f0-9]{64}$/i.test((value as { expected_map_sha256?: unknown }).expected_map_sha256 as string)) {
    throw contractError('invalid_sourcemap_supersede', 422, 'Source Map supersede request is invalid')
  }
  return (value as { expected_map_sha256: string }).expected_map_sha256.toLowerCase()
}

export function prepareSourceMapArtifact(input: Pick<SourceMapUploadRequest, 'release' | 'dist' | 'artifact_path' | 'map' | 'map_sha256'>): PreparedSourceMapArtifact {
  const release = requireIdentifier(input.release, 'release')
  const dist = requireIdentifier(input.dist ?? 'default', 'dist')
  const artifactPath = requireArtifactPath(input.artifact_path)
  const parsed = parseAndValidateMap(input.map)
  const mapSha256 = createHash('sha256').update(parsed.content).digest('hex')
  if (input.map_sha256 !== undefined && (!/^[a-f0-9]{64}$/i.test(input.map_sha256) || input.map_sha256 !== mapSha256)) {
    throw contractError('invalid_sourcemap', 422, 'Source Map checksum does not match content')
  }
  return { release, dist, artifactPath, mapSha256, mappingBlob: parsed.content, sourceCount: parsed.sourceCount }
}

function publicArtifact(artifact: SourceMapArtifact): SourceMapUploadResponse {
  return {
    artifact: {
      id: artifact.id,
      release: artifact.release,
      dist: artifact.dist,
      artifact_path: artifact.artifactPath,
      map_sha256: artifact.mapSha256,
      source_count: artifact.sourceCount,
      created_at: artifact.createdAt.toISOString(),
    },
  }
}

export function parseAndValidateMap(input: unknown): { content: string; sourceCount: number } {
  if (typeof input !== 'string') throw contractError('invalid_sourcemap', 422, 'Source Map must be a UTF-8 JSON string')
  if (Buffer.byteLength(input, 'utf8') > MAX_MAP_BYTES) throw contractError('sourcemap_too_large', 413, 'Source Map exceeds 5 MiB')
  let map: unknown
  try {
    map = JSON.parse(input)
  } catch {
    throw contractError('invalid_sourcemap', 422, 'Source Map is not valid JSON')
  }
  if (!isSourceMapV3(map) || map.sections !== undefined || map.sourcesContent !== undefined) {
    throw contractError('invalid_sourcemap', 422, 'Source Map must be a sanitized version 3 map')
  }
  validateMap(map)
  const content = JSON.stringify(map)
  if (Buffer.byteLength(content, 'utf8') > MAX_MAP_BYTES) throw contractError('sourcemap_too_large', 413, 'Source Map exceeds 5 MiB')
  return { content, sourceCount: map.sources.length }
}

function isUploadKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 1024 && value.trim() === value && !CONTROL_CHAR.test(value)
}

function requireIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 200 || CONTROL_CHAR.test(value)) {
    throw contractError('invalid_sourcemap', 422, `Source Map ${label} is invalid`)
  }
  return value
}

function requireArtifactPath(value: unknown): string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 2048 || !value.startsWith('/') || value.includes('..') ||
    CONTROL_CHAR.test(value) || value.includes('?') || value.includes('#') || value.includes('@') || value.includes('://') || value.includes('\\')) {
    throw contractError('invalid_sourcemap', 422, 'Source Map artifact path is invalid')
  }
  return value
}

function isSourceMapV3(value: unknown): value is SourceMapV3 {
  if (!value || typeof value !== 'object') return false
  const map = value as Record<string, unknown>
  return map.version === 3 && Array.isArray(map.sources) && Array.isArray(map.names) && typeof map.mappings === 'string'
}

function validateMap(map: SourceMapV3): void {
  if (map.sources.length > MAX_SOURCES || map.names.length > MAX_NAMES || !map.mappings ||
    map.mappings.length > MAX_MAPPING_CHARS || map.mappings.split(';').length > MAX_MAPPING_LINES) {
    throw contractError('invalid_sourcemap', 422, 'Source Map exceeds structural limits')
  }
  if (map.sourceRoot !== undefined && (!isSafeSourcePath(map.sourceRoot) || REMOTE_URL.test(map.sourceRoot))) {
    throw contractError('invalid_sourcemap', 422, 'Source Map sourceRoot is unsafe')
  }
  for (const source of map.sources) {
    if (typeof source !== 'string' || !isSafeSourcePath(source)) throw contractError('invalid_sourcemap', 422, 'Source Map source path is unsafe')
  }
  for (const name of map.names) {
    if (typeof name !== 'string' || CONTROL_CHAR.test(name)) throw contractError('invalid_sourcemap', 422, 'Source Map name is unsafe')
  }
  validateMappings(map.mappings, map.sources.length, map.names.length)
}

function isSafeSourcePath(value: string): boolean {
  return value.length <= 1024 && !CONTROL_CHAR.test(value) && !ABSOLUTE_LOCAL_PATH.test(value) && !REMOTE_URL.test(value)
}

function validateMappings(mappings: string, sourceCount: number, nameCount: number): void {
  let previousSource = 0
  let previousOriginalLine = 0
  let previousOriginalColumn = 0
  let previousName = 0
  for (const line of mappings.split(';')) {
    let previousGeneratedColumn = 0
    for (const segment of line.split(',')) {
      if (!segment) continue
      const values = decodeVlqSegment(segment)
      if (values.length !== 1 && values.length !== 4 && values.length !== 5) throw contractError('invalid_sourcemap', 422, 'Source Map mappings are invalid')
      previousGeneratedColumn += values[0]!
      if (previousGeneratedColumn < 0) throw contractError('invalid_sourcemap', 422, 'Source Map mappings are invalid')
      if (values.length >= 4) {
        previousSource += values[1]!
        previousOriginalLine += values[2]!
        previousOriginalColumn += values[3]!
        if (previousSource < 0 || previousSource >= sourceCount || previousOriginalLine < 0 || previousOriginalColumn < 0) {
          throw contractError('invalid_sourcemap', 422, 'Source Map mappings are invalid')
        }
        if (values.length === 5) {
          previousName += values[4]!
          if (previousName < 0 || previousName >= nameCount) throw contractError('invalid_sourcemap', 422, 'Source Map mappings are invalid')
        }
      }
    }
  }
}

function decodeVlqSegment(segment: string): number[] {
  const output: number[] = []
  let value = 0
  let shift = 0
  for (const character of segment) {
    const digit = base64VlqDigit(character)
    if (digit < 0) throw contractError('invalid_sourcemap', 422, 'Source Map mappings are invalid')
    value += (digit & 31) << shift
    shift += 5
    if (shift > 30) throw contractError('invalid_sourcemap', 422, 'Source Map mappings are invalid')
    if ((digit & 32) === 0) {
      output.push((value & 1) === 1 ? -(value >> 1) : value >> 1)
      value = 0
      shift = 0
    }
  }
  if (shift !== 0) throw contractError('invalid_sourcemap', 422, 'Source Map mappings are invalid')
  return output
}

function base64VlqDigit(character: string): number {
  const code = character.charCodeAt(0)
  if (code >= 65 && code <= 90) return code - 65
  if (code >= 97 && code <= 122) return code - 97 + 26
  if (code >= 48 && code <= 57) return code - 48 + 52
  if (character === '+') return 62
  if (character === '/') return 63
  return -1
}

function contractError(code: string, status: number, message: string): SourceMapContractError {
  return new SourceMapContractError(code, status, message)
}

export default class SourceMapsService extends Service {
  async upload(request: SourceMapUploadRequest): Promise<SourceMapUploadResponse> {
    return uploadSourceMap(request, sourceMapDependenciesFromApp(this.app))
  }
}
