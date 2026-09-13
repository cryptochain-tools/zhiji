import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { S3CompatibleObjectStore } from '../artifacts/s3'

const MAX_SOURCE_MAP_BYTES = 5 * 1024 * 1024

export interface PrivateSourceMapArtifact {
  /** Opaque handle; never a URL or a filesystem path. */
  ref: string
  byteCount: number
}

/**
 * Source maps are uploaded only after structural sanitization, but they still
 * reveal source paths and symbol names. They therefore live outside the main
 * database and outside every public/static directory.
 */
export interface PrivateSourceMapArtifactStore {
  put(input: { artifactId: string; contents: Buffer }): Promise<PrivateSourceMapArtifact>
  read(ref: string): Promise<Buffer | null>
  remove(ref: string): Promise<void>
}

export class SourceMapArtifactStoreUnavailableError extends Error {
  constructor() { super('sourcemap_artifact_store_unavailable') }
}

/** Deployment-owned local adapter. Object-store adapters keep the same opaque contract. */
export class LocalPrivateSourceMapArtifactStore implements PrivateSourceMapArtifactStore {
  constructor(private readonly root: string) {
    if (!isAbsolute(root)) throw new Error('sourcemap artifact directory must be absolute')
  }

  async put(input: { artifactId: string; contents: Buffer }): Promise<PrivateSourceMapArtifact> {
    if (!isUuid(input.artifactId)) throw new Error('invalid_sourcemap_artifact_id')
    if (input.contents.length < 1 || input.contents.length > MAX_SOURCE_MAP_BYTES) throw new Error('sourcemap_artifact_size_invalid')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const ref = `sourcemap/${input.artifactId}.json`
    const file = await open(this.path(ref), 'wx', 0o600)
    try { await file.writeFile(input.contents) } finally { await file.close() }
    return { ref, byteCount: input.contents.length }
  }

  async read(ref: string): Promise<Buffer | null> {
    try { return await readFile(this.path(ref)) } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  }

  async remove(ref: string): Promise<void> { await rm(this.path(ref), { force: true }) }

  private path(ref: string): string {
    if (!/^sourcemap\/[0-9a-f-]{36}\.json$/.test(ref)) throw new Error('invalid_sourcemap_artifact_ref')
    return join(this.root, createHash('sha256').update(ref).digest('hex'))
  }
}

export function sourceMapArtifactStoreFromConfig(value: unknown): PrivateSourceMapArtifactStore | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<PrivateSourceMapArtifactStore>
  return typeof candidate.put === 'function' && typeof candidate.read === 'function' && typeof candidate.remove === 'function'
    ? candidate as PrivateSourceMapArtifactStore
    : undefined
}

function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }

/** S3-compatible private Source Map storage; map contents never receive a public URL. */
export class S3PrivateSourceMapArtifactStore implements PrivateSourceMapArtifactStore {
  constructor(private readonly objects: S3CompatibleObjectStore) {}

  async put(input: { artifactId: string; contents: Buffer }): Promise<PrivateSourceMapArtifact> {
    if (!isUuid(input.artifactId)) throw new Error('invalid_sourcemap_artifact_id')
    if (input.contents.length < 1 || input.contents.length > MAX_SOURCE_MAP_BYTES) throw new Error('sourcemap_artifact_size_invalid')
    const ref = `sourcemap/${input.artifactId}.json`
    await this.objects.put(ref, input.contents)
    return { ref, byteCount: input.contents.length }
  }

  read(ref: string): Promise<Buffer | null> { this.assertRef(ref); return this.objects.read(ref) }
  remove(ref: string): Promise<void> { this.assertRef(ref); return this.objects.remove(ref) }
  private assertRef(ref: string): void { if (!/^sourcemap\/[0-9a-f-]{36}\.json$/i.test(ref)) throw new Error('invalid_sourcemap_artifact_ref') }
}
