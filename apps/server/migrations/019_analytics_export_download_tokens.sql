CREATE TABLE analytics_export_download_tokens (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  export_job_id uuid NOT NULL REFERENCES analytics_export_jobs(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (octet_length(token_hash) = 32),
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX analytics_export_download_token_active_idx
  ON analytics_export_download_tokens(export_job_id, requested_by)
  WHERE used_at IS NULL;
CREATE INDEX analytics_export_download_token_lookup_idx
  ON analytics_export_download_tokens(tenant_id, project_id, export_job_id, requested_by, expires_at);
