export interface SourceMapManagementScope { tenantId: string; projectId: string }
export interface SourceMapMetadataRow {
  id: string; release: string; dist: string; artifact_path: string; map_sha256: string
  format_version: number; source_count: number; created_at: Date; superseded_at: Date | null
}
export interface SourceMapMetadata {
  id: string; release: string; dist: string; artifact_path: string; map_sha256: string
  format_version: 3; source_count: number; created_at: string; superseded_at: string | null
}
