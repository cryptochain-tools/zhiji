import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { S3CompatibleObjectStore } from '../artifacts/s3'

export interface PrivateReplayArtifact {
  /** Opaque internal handle, never a URL or filesystem path. */
  ref: string
  byteCount: number
}

/**
 * Replay payloads are sensitive even after the recorder's field allow-list.
 * Stores therefore only accept opaque references and must not provide a URL.
 */
export interface PrivateReplayArtifactStore {
  put(input: { tenantId: string; projectId: string; sessionId: string; chunkId: string; contents: Buffer }): Promise<PrivateReplayArtifact>
  read(ref: string): Promise<Buffer | null>
  remove(ref: string): Promise<void>
}

export class ReplayArtifactStoreUnavailableError extends Error {
  constructor() { super('replay_artifact_store_unavailable') }
}

/** A deployment-owned private directory, deliberately outside a static web root. */
export class LocalPrivateReplayArtifactStore implements PrivateReplayArtifactStore {
  constructor(private readonly root: string) {
    if (!isAbsolute(root)) throw new Error('replay artifact directory must be absolute')
  }

  async put(input: { tenantId: string; projectId: string; sessionId: string; chunkId: string; contents: Buffer }): Promise<PrivateReplayArtifact> {
    if (input.contents.length < 1 || input.contents.length > 256 * 1024) throw new Error('replay_artifact_size_invalid')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const ref = `replay/${randomUUID()}.json`
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
    if (!/^replay\/[0-9a-f-]{36}\.json$/.test(ref)) throw new Error('invalid_replay_artifact_ref')
    return join(this.root, createHash('sha256').update(ref).digest('hex'))
  }
}

/** Private S3-compatible adapter. Object names remain opaque refs and no storage URL is exposed. */
export class S3PrivateReplayArtifactStore implements PrivateReplayArtifactStore {
  constructor(private readonly objects: S3CompatibleObjectStore) {}

  async put(input: { tenantId: string; projectId: string; sessionId: string; chunkId: string; contents: Buffer }): Promise<PrivateReplayArtifact> {
    if (input.contents.length < 1 || input.contents.length > 256 * 1024) throw new Error('replay_artifact_size_invalid')
    const ref = `replay/${randomUUID()}.json`
    await this.objects.put(ref, input.contents)
    return { ref, byteCount: input.contents.length }
  }

  read(ref: string): Promise<Buffer | null> { this.assertRef(ref); return this.objects.read(ref) }
  remove(ref: string): Promise<void> { this.assertRef(ref); return this.objects.remove(ref) }
  private assertRef(ref: string): void { if (!/^replay\/[0-9a-f-]{36}\.json$/i.test(ref)) throw new Error('invalid_replay_artifact_ref') }
}
