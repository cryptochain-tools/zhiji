import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { S3CompatibleObjectStore } from '../artifacts/s3'

export interface PrivateExportArtifact {
  ref: string
  byteCount: number
}

/** Private artifact storage abstraction. Implementations must never expose a public URL. */
export interface PrivateExportArtifactStore {
  put(input: { tenantId: string; projectId: string; jobId: string; format: 'csv' | 'xlsx' | 'json'; contents: Buffer; kind?: 'analytics-export' | 'report-run' | 'subject-export' }): Promise<PrivateExportArtifact>
  read(ref: string): Promise<Buffer | null>
  remove(ref: string): Promise<void>
}

/**
 * An explicitly configured, local private directory. Files are created 0600 and
 * addressed by opaque ids only; this is deliberately not a web-root adapter.
 */
export class LocalPrivateExportArtifactStore implements PrivateExportArtifactStore {
  constructor(private readonly root: string) {
    if (!isAbsolute(root)) throw new Error('analytics export artifact directory must be absolute')
  }

  async put(input: { tenantId: string; projectId: string; jobId: string; format: 'csv' | 'xlsx' | 'json'; contents: Buffer; kind?: 'analytics-export' | 'report-run' | 'subject-export' }): Promise<PrivateExportArtifact> {
    if (input.contents.length > 50 * 1024 * 1024) throw new Error('export_limit_exceeded')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const ref = `${input.kind ?? 'analytics-export'}/${randomUUID()}.${input.format}`
    const path = this.path(ref)
    const file = await open(path, 'wx', 0o600)
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
    if (!/^(analytics-export|report-run)\/[0-9a-f-]{36}\.(csv|xlsx)$|^subject-export\/[0-9a-f-]{36}\.json$/.test(ref)) throw new Error('invalid_private_artifact_ref')
    return join(this.root, createHash('sha256').update(ref).digest('hex'))
  }
}

/** Private S3-compatible adapter. The application streams bytes after authorization; this class never returns an object URL. */
export class S3PrivateExportArtifactStore implements PrivateExportArtifactStore {
  constructor(private readonly objects: S3CompatibleObjectStore) {}

  async put(input: { tenantId: string; projectId: string; jobId: string; format: 'csv' | 'xlsx' | 'json'; contents: Buffer; kind?: 'analytics-export' | 'report-run' | 'subject-export' }): Promise<PrivateExportArtifact> {
    if (input.contents.length > 50 * 1024 * 1024) throw new Error('export_limit_exceeded')
    const kind = input.kind ?? 'analytics-export'
    if (kind === 'subject-export' && input.format !== 'json') throw new Error('invalid_private_artifact_ref')
    if (kind !== 'subject-export' && input.format === 'json') throw new Error('invalid_private_artifact_ref')
    const ref = `${kind}/${randomUUID()}.${input.format}`
    await this.objects.put(ref, input.contents)
    return { ref, byteCount: input.contents.length }
  }

  read(ref: string): Promise<Buffer | null> { this.assertRef(ref); return this.objects.read(ref) }
  remove(ref: string): Promise<void> { this.assertRef(ref); return this.objects.remove(ref) }
  private assertRef(ref: string): void { if (!/^(analytics-export|report-run)\/[0-9a-f-]{36}\.(csv|xlsx)$|^subject-export\/[0-9a-f-]{36}\.json$/i.test(ref)) throw new Error('invalid_private_artifact_ref') }
}
