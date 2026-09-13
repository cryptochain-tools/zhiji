export interface SourceMapUploadRequest {
  key: string
  release: string
  dist?: string
  artifact_path: string
  map: string
  map_sha256?: string
  /**
   * CI-only compare-and-swap replacement. It is accepted only together with a
   * SourceMapUploadKey and never through a browser management request.
   */
  supersede?: { expected_map_sha256: string }
}

export interface SourceMapUploadScope {
  keyId: string
  tenantId: string
  projectId: string
  disabled: boolean
}

export interface SourceMapArtifact {
  id: string
  tenantId: string
  projectId: string
  release: string
  dist: string
  artifactPath: string
  mapSha256: string
  formatVersion: 3
  /** Sanitized mapping JSON only. It must never contain sourcesContent. */
  mappingBlob: string
  sourceCount: number
  createdByKeyId: string
  createdAt: Date
  supersededAt?: Date | null
}

/** Validated, normalized data shared by upload and explicit management supersede. */
export interface PreparedSourceMapArtifact {
  release: string
  dist: string
  artifactPath: string
  mapSha256: string
  mappingBlob: string
  sourceCount: number
}

export type SourceMapArtifactWrite =
  | { status: 'created'; artifact: SourceMapArtifact }
  | { status: 'idempotent'; artifact: SourceMapArtifact }
  | { status: 'conflict' }

/**
 * Persistence boundary deliberately exposes no read operation for map content.
 * An implementation must scope writes by the authenticated key, and only accept
 * already validated mapping blobs from this module.
 */
export interface SourceMapArtifactStore {
  putIfAbsent(input: SourceMapArtifact): Promise<SourceMapArtifactWrite>
  supersede?(input: SourceMapArtifact, expectedMapSha256: string): Promise<SourceMapArtifactWrite>
}

export interface SourceMapKeyAuthorizer {
  authenticate(key: string): Promise<SourceMapUploadScope | null>
}

export interface SourceMapDependencies {
  keys: SourceMapKeyAuthorizer
  artifacts: SourceMapArtifactStore
  now?: () => Date
  createId?: () => string
}

export interface SourceMapUploadResponse {
  artifact: {
    id: string
    release: string
    dist: string
    artifact_path: string
    map_sha256: string
    source_count: number
    created_at: string
  }
}
