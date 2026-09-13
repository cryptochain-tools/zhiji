-- Preserve historical mapping explanations while making the active release key explicit.
BEGIN;

ALTER TABLE source_map_artifacts ADD COLUMN superseded_at timestamptz NULL;
-- PostgreSQL truncates generated constraint names, so discover the legacy full
-- scope uniqueness constraint by definition instead of assuming its name.
DO $$
DECLARE legacy_constraint text;
BEGIN
  SELECT c.conname INTO legacy_constraint
  FROM pg_constraint AS c
  INNER JOIN pg_class AS relation ON relation.oid = c.conrelid
  INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE c.contype = 'u'
    AND namespace.nspname = current_schema()
    AND relation.relname = 'source_map_artifacts'
    AND pg_get_constraintdef(c.oid) LIKE 'UNIQUE (tenant_id, project_id, release, dist, artifact_path)%'
  LIMIT 1;
  IF legacy_constraint IS NULL THEN
    RAISE EXCEPTION 'source_map_artifacts active scope uniqueness constraint is missing';
  END IF;
  EXECUTE format('ALTER TABLE source_map_artifacts DROP CONSTRAINT %I', legacy_constraint);
END $$;
CREATE UNIQUE INDEX source_map_artifacts_active_scope_key
  ON source_map_artifacts (tenant_id, project_id, release, dist, artifact_path)
  WHERE superseded_at IS NULL;
CREATE INDEX source_map_artifacts_history_idx
  ON source_map_artifacts (tenant_id, project_id, superseded_at, created_at DESC);

COMMIT;
