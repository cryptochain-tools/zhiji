-- Source Map bytes are private deployment artifacts, not database facts. New
-- uploads always have an opaque ref; historic rows become unresolved until a
-- trusted CI upload replaces them, then cleanup removes their metadata after
-- the associated error-retention horizon.
BEGIN;

ALTER TABLE source_map_artifacts ADD COLUMN artifact_ref text;
ALTER TABLE source_map_artifacts ADD COLUMN mapping_byte_count integer;
ALTER TABLE source_map_artifacts DROP COLUMN mapping_blob;

ALTER TABLE source_map_artifacts
  ADD CONSTRAINT source_map_artifacts_private_ref_check
  CHECK (
    (artifact_ref IS NULL AND mapping_byte_count IS NULL)
    OR (artifact_ref IS NOT NULL AND mapping_byte_count BETWEEN 1 AND 5242880)
  );
ALTER TABLE source_map_artifacts
  ADD CONSTRAINT source_map_artifacts_private_ref_format_check
  CHECK (artifact_ref IS NULL OR (length(artifact_ref) BETWEEN 1 AND 1024 AND artifact_ref ~ '^sourcemap/[0-9a-f-]{36}\.json$'));
CREATE INDEX source_map_artifacts_cleanup_idx
  ON source_map_artifacts (tenant_id, project_id, created_at ASC, id ASC);

COMMIT;
