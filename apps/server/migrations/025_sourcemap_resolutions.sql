-- Cache safe Source Map positions without retaining source text or exposing mapping blobs.
BEGIN;

ALTER TABLE source_map_artifacts
  ADD CONSTRAINT source_map_artifacts_tenant_project_id_key UNIQUE (tenant_id, project_id, id);

CREATE TABLE source_map_resolutions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  generated_filename text NOT NULL,
  generated_line integer NOT NULL,
  generated_column integer NOT NULL,
  original_source text,
  original_line integer,
  original_column integer,
  function_name text,
  resolver_version text NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, artifact_id, generated_filename, generated_line, generated_column, resolver_version),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, artifact_id) REFERENCES source_map_artifacts(tenant_id, project_id, id) ON DELETE CASCADE,
  CHECK (length(generated_filename) BETWEEN 1 AND 2048),
  CHECK (generated_filename LIKE '/%' AND generated_filename !~ '[\\?#[:cntrl:]]'),
  CHECK (generated_line >= 1 AND generated_column >= 0),
  CHECK ((original_source IS NULL) = (original_line IS NULL)),
  CHECK ((original_source IS NULL) = (original_column IS NULL)),
  CHECK (original_line IS NULL OR original_line >= 1),
  CHECK (original_column IS NULL OR original_column >= 0),
  CHECK (function_name IS NULL OR length(function_name) BETWEEN 1 AND 512),
  CHECK (length(resolver_version) BETWEEN 1 AND 100)
);
CREATE INDEX source_map_resolutions_artifact_resolved_idx
  ON source_map_resolutions (tenant_id, project_id, artifact_id, resolved_at DESC);

COMMIT;
