-- 已净化的 Source Map 映射仅存于私有数据库列；不保存 sourcesContent 或对象存储副本。
BEGIN;

CREATE TABLE source_map_artifacts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  release text NOT NULL,
  dist text NOT NULL,
  artifact_path text NOT NULL,
  map_sha256 text NOT NULL,
  format_version smallint NOT NULL,
  mapping_blob text NOT NULL,
  source_count integer NOT NULL,
  created_by_key_id uuid NOT NULL REFERENCES project_keys(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, release, dist, artifact_path),
  CHECK (length(release) BETWEEN 1 AND 200),
  CHECK (length(dist) BETWEEN 1 AND 200),
  CHECK (artifact_path LIKE '/%'),
  CHECK (length(map_sha256) = 64),
  CHECK (format_version = 3),
  CHECK (source_count BETWEEN 0 AND 5000),
  CHECK (position('"sourcesContent"' in mapping_blob) = 0)
);
CREATE INDEX source_map_artifacts_lookup_idx
  ON source_map_artifacts (tenant_id, project_id, release, dist, artifact_path);

COMMIT;
