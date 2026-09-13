import { createHash } from 'node:crypto'
import { promises as dns } from 'node:dns'

import type { OutputAsset, OutputBundle, OutputChunk } from 'rollup'
import type { Plugin } from 'vite'

const UPLOAD_PATH = '/api/sourcemaps/upload'
const DEFAULT_DIST = 'default'
const MAX_MAP_BYTES = 5 * 1024 * 1024
const MAX_SOURCES = 5_000
const MAX_NAMES = 50_000
const MAX_MAPPING_CHARS = 2_000_000
const MAX_MAPPING_LINES = 200_000
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/
const ABSOLUTE_LOCAL_PATH = /^(?:[A-Za-z]:[\\/]|[/\\]{1,2})/
const REMOTE_URL = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
const SOURCE_MAPPING_URL = /\n?\/\/[#@]\s*sourceMappingURL=.*?(?=\r?\n|$)|\n?\/\*#\s*sourceMappingURL=.*?\*\//g

export interface ZhijiSourceMapOptions {
  enabled: boolean
  endpoint?: string
  key?: string
  release?: string
  dist?: string
  publicBasePath?: string
  /** Enabled uploads always fail the build on error. This must be true when set. */
  failBuild?: true
  /** Injectable only for tests. Node 18+ global fetch is used by default. */
  fetch?: typeof globalThis.fetch
}

interface SourceMapV3 {
  version: 3
  file?: string
  sourceRoot?: string
  sources: string[]
  sourcesContent?: unknown
  names: string[]
  mappings: string
  sections?: unknown
  [key: string]: unknown
}

interface UploadResponse {
  artifact?: { map_sha256?: string }
  data?: { artifact?: { map_sha256?: string } }
}

interface PreparedMap {
  content: string
  sha256: string
  sourceCount: number
}

interface ValidatedOptions {
  endpoint: URL
  key: string
  release: string
  dist: string
  publicBasePath: string
  fetch: typeof globalThis.fetch
}

export function zhijiSourceMaps(options: ZhijiSourceMapOptions): Plugin {
  let isBuild = false
  let isSsrBuild = false
  let isProductionBuild = false

  return {
    name: 'zhiji-sourcemaps',
    apply: 'build',
    configResolved(config) {
      isBuild = config.command === 'build'
      isSsrBuild = Boolean(config.build.ssr)
      isProductionBuild = config.mode === 'production'
    },
    async generateBundle(_outputOptions, bundle) {
      if (!options.enabled) return
      if (!isBuild || isSsrBuild || !isProductionBuild) {
        throw new Error('[zhiji-sourcemaps] uploads are only allowed in production, non-SSR Vite builds')
      }

      const validated = await validateOptions(options)
      // Vite 8 currently supplies Rolldown's structurally compatible output
      // types here, while the public artifact types live in Rollup.
      await uploadBundleMaps(bundle as unknown as OutputBundle, validated)
    },
  }
}

/** Exported to keep the safety-critical bundle transformation directly testable. */
export async function uploadBundleMaps(bundle: OutputBundle, options: ValidatedOptions): Promise<void> {
  const maps = Object.entries(bundle).filter(([, item]) => item.type === 'asset' && item.fileName.endsWith('.map')) as Array<
    [string, OutputAsset]
  >
  if (maps.length === 0) {
    throw new Error('[zhiji-sourcemaps] enabled but no source map assets were generated; use build.sourcemap: "hidden"')
  }

  const seenPaths = new Set<string>()
  const uploaded: Array<{ mapFileName: string; chunk: OutputChunk }> = []
  for (const [mapFileName, mapAsset] of maps) {
    if (mapAsset.fileName !== mapFileName) {
      throw new Error('[zhiji-sourcemaps] output bundle source map filename is inconsistent')
    }
    const chunkFileName = mapFileName.slice(0, -'.map'.length)
    const chunk = bundle[chunkFileName]
    if (!chunk || chunk.type !== 'chunk' || !isJavaScriptArtifact(chunkFileName)) {
      throw new Error(`[zhiji-sourcemaps] map ${safeFileName(mapFileName)} has no adjacent JavaScript chunk`)
    }

    const artifactPath = toArtifactPath(chunkFileName, options.publicBasePath)
    if (seenPaths.has(artifactPath)) {
      throw new Error(`[zhiji-sourcemaps] duplicate artifact path ${artifactPath}`)
    }
    seenPaths.add(artifactPath)

    const prepared = prepareSourceMap(mapAsset.source)
    await uploadMap(options, artifactPath, prepared)
    uploaded.push({ mapFileName, chunk })
  }

  // Mutate only after every upload succeeds, so any subsequent publisher sees either
  // the original bundle after a failed build, or a bundle with every map removed.
  for (const { mapFileName, chunk } of uploaded) {
    delete bundle[mapFileName]
    chunk.code = chunk.code.replace(SOURCE_MAPPING_URL, '')
  }
}

export function prepareSourceMap(source: string | Uint8Array): PreparedMap {
  const content = typeof source === 'string' ? source : new TextDecoder().decode(source)
  if (new TextEncoder().encode(content).byteLength > MAX_MAP_BYTES) {
    throw new Error('[zhiji-sourcemaps] source map exceeds 5 MiB')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('[zhiji-sourcemaps] source map is not valid JSON')
  }
  if (!isSourceMapV3(parsed)) {
    throw new Error('[zhiji-sourcemaps] expected a Source Map v3 object')
  }
  if (parsed.sections !== undefined) throw new Error('[zhiji-sourcemaps] index source maps are not supported')
  if (parsed.sourcesContent !== undefined) delete parsed.sourcesContent
  validateSourceMap(parsed)

  const sanitized = JSON.stringify(parsed)
  const sha256 = createHash('sha256').update(sanitized).digest('hex')
  return { content: sanitized, sha256, sourceCount: parsed.sources.length }
}

async function validateOptions(options: ZhijiSourceMapOptions): Promise<ValidatedOptions> {
  if (!options.endpoint || !options.key || !options.release) {
    throw new Error('[zhiji-sourcemaps] endpoint, key, and release are required when enabled')
  }
  if (options.key.trim() !== options.key || options.key.length < 16 || /^VITE_/i.test(options.key)) {
    throw new Error('[zhiji-sourcemaps] upload key is invalid or browser-exposed')
  }
  const endpoint = await validateEndpoint(options.endpoint)
  const release = validateIdentifier(options.release, 'release')
  const dist = validateIdentifier(options.dist ?? DEFAULT_DIST, 'dist')
  const publicBasePath = normalizePublicBasePath(options.publicBasePath ?? '/')
  const fetchImplementation = options.fetch ?? globalThis.fetch
  if (!fetchImplementation) throw new Error('[zhiji-sourcemaps] fetch is unavailable; use Node.js 18 or provide fetch')
  return { endpoint, key: options.key, release, dist, publicBasePath, fetch: fetchImplementation }
}

async function validateEndpoint(input: string): Promise<URL> {
  let endpoint: URL
  try {
    endpoint = new URL(input)
  } catch {
    throw new Error('[zhiji-sourcemaps] endpoint must be a valid HTTPS URL')
  }
  if (endpoint.protocol !== 'https:' || endpoint.pathname !== UPLOAD_PATH || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
    throw new Error(`[zhiji-sourcemaps] endpoint must be an HTTPS origin with path ${UPLOAD_PATH}`)
  }
  if (isPrivateHost(endpoint.hostname)) throw new Error('[zhiji-sourcemaps] endpoint must not use a private host')
  await ensurePublicDns(endpoint.hostname)
  return endpoint
}

async function ensurePublicDns(hostname: string): Promise<void> {
  let records: readonly { address: string }[]
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('[zhiji-sourcemaps] endpoint hostname could not be resolved')
  }
  if (records.length === 0 || records.some(record => isPrivateHost(record.address))) {
    throw new Error('[zhiji-sourcemaps] endpoint hostname resolves to a non-public address')
  }
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local') || host === '::1') return true
  if (/^(?:0|10|127)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) || /^198\.(?:18|19)\./.test(host) || /^(?:22[4-9]|23\d|24\d|25[0-5])\./.test(host)) return true
  const match = /^172\.(\d+)\./.exec(host)
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true
  if (/^(?:fc|fd|fe[89ab]|::|::1$)/i.test(host)) return true
  const mapped = /^::ffff:(.+)$/i.exec(host)
  return Boolean(mapped && isPrivateHost(mapped[1]!))
}

function validateIdentifier(value: string, label: string): string {
  if (!value || value.length > 200 || CONTROL_CHAR.test(value)) throw new Error(`[zhiji-sourcemaps] ${label} is invalid`)
  return value
}

function normalizePublicBasePath(basePath: string): string {
  if (!basePath.startsWith('/') || basePath.includes('?') || basePath.includes('#') || basePath.includes('..') || CONTROL_CHAR.test(basePath)) {
    throw new Error('[zhiji-sourcemaps] publicBasePath must be an absolute public pathname')
  }
  return basePath.endsWith('/') ? basePath : `${basePath}/`
}

function toArtifactPath(fileName: string, basePath: string): string {
  if (!fileName || fileName.includes('..') || CONTROL_CHAR.test(fileName) || fileName.startsWith('/') || fileName.startsWith('\\')) {
    throw new Error('[zhiji-sourcemaps] invalid output artifact filename')
  }
  return `${basePath}${fileName}`.replace(/\/+/g, '/')
}

function isJavaScriptArtifact(fileName: string): boolean {
  return /\.(?:[cm]?js)$/i.test(fileName)
}

function isSourceMapV3(value: unknown): value is SourceMapV3 {
  if (!value || typeof value !== 'object') return false
  const map = value as Record<string, unknown>
  return map.version === 3 && Array.isArray(map.sources) && Array.isArray(map.names) && typeof map.mappings === 'string'
}

function validateSourceMap(map: SourceMapV3): void {
  if (map.sources.length > MAX_SOURCES || map.names.length > MAX_NAMES) throw new Error('[zhiji-sourcemaps] source map has too many sources or names')
  if (!map.mappings || map.mappings.length > MAX_MAPPING_CHARS || map.mappings.split(';').length > MAX_MAPPING_LINES) {
    throw new Error('[zhiji-sourcemaps] source map mappings are invalid or too large')
  }
  if (map.sourceRoot !== undefined && (!isSafeSourcePath(map.sourceRoot) || REMOTE_URL.test(map.sourceRoot))) {
    throw new Error('[zhiji-sourcemaps] sourceRoot is unsafe')
  }
  for (const source of map.sources) {
    if (typeof source !== 'string' || !isSafeSourcePath(source)) throw new Error('[zhiji-sourcemaps] source path is unsafe')
  }
  for (const name of map.names) {
    if (typeof name !== 'string' || CONTROL_CHAR.test(name)) throw new Error('[zhiji-sourcemaps] source map name is unsafe')
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
    for (const segment of line ? line.split(',') : []) {
      const values = decodeVlqSegment(segment)
      if (values.length !== 1 && values.length !== 4 && values.length !== 5) throw new Error('[zhiji-sourcemaps] invalid VLQ segment')
      previousGeneratedColumn += values[0]
      if (previousGeneratedColumn < 0) throw new Error('[zhiji-sourcemaps] invalid generated column')
      if (values.length > 1) {
        previousSource += values[1]
        previousOriginalLine += values[2]
        previousOriginalColumn += values[3]
        if (previousSource < 0 || previousSource >= sourceCount || previousOriginalLine < 0 || previousOriginalColumn < 0) {
          throw new Error('[zhiji-sourcemaps] invalid original position')
        }
        if (values.length === 5) {
          previousName += values[4]
          if (previousName < 0 || previousName >= nameCount) throw new Error('[zhiji-sourcemaps] invalid name index')
        }
      }
    }
  }
}

function decodeVlqSegment(segment: string): number[] {
  if (!segment) throw new Error('[zhiji-sourcemaps] empty VLQ segment')
  const values: number[] = []
  let value = 0
  let shift = 0
  let continuation = false
  for (const character of segment) {
    const digit = base64VlqDigit(character)
    if (digit < 0) throw new Error('[zhiji-sourcemaps] invalid VLQ character')
    continuation = (digit & 32) !== 0
    value += (digit & 31) << shift
    shift += 5
    if (shift > 30) throw new Error('[zhiji-sourcemaps] VLQ value is too large')
    if (!continuation) {
      values.push((value & 1) === 1 ? -(value >> 1) : value >> 1)
      value = 0
      shift = 0
    }
  }
  if (continuation) throw new Error('[zhiji-sourcemaps] unterminated VLQ segment')
  return values
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

async function uploadMap(options: ValidatedOptions, artifactPath: string, map: PreparedMap): Promise<void> {
  const response = await options.fetch(options.endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'X-Zhiji-SourceMap-Key': options.key,
    },
    body: JSON.stringify({
      release: options.release,
      dist: options.dist,
      artifact_path: artifactPath,
      map: map.content,
      map_sha256: map.sha256,
    }),
  })
  if (!response.ok) {
    throw new Error(`[zhiji-sourcemaps] upload failed for ${artifactPath} (HTTP ${response.status})`)
  }
  const responseJson = (await response.json()) as UploadResponse
  const artifact = responseJson.artifact ?? responseJson.data?.artifact
  if (!artifact || artifact.map_sha256 !== map.sha256) {
    throw new Error(`[zhiji-sourcemaps] upload response could not be verified for ${artifactPath}`)
  }
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[\r\n]/g, '')
}
