BEGIN;

-- Subject exports are private, short-lived JSON artifacts. Database rows carry
-- only opaque handles; the contents remain in the deployment-owned store.
ALTER TABLE data_subject_jobs
  ADD COLUMN artifact_ref text,
  ADD COLUMN byte_count bigint,
  ADD CONSTRAINT data_subject_jobs_export_artifact_check CHECK (
    (kind = 'subject_export' AND ((artifact_ref IS NULL AND byte_count IS NULL) OR (artifact_ref ~ '^subject-export/[0-9a-f-]{36}\\.json$' AND byte_count BETWEEN 1 AND 52428800)))
    OR (kind = 'subject_deletion' AND artifact_ref IS NULL AND byte_count IS NULL)
  );

CREATE TABLE data_subject_export_download_tokens (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  data_subject_job_id uuid NOT NULL REFERENCES data_subject_jobs(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (octet_length(token_hash) = 32),
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX data_subject_export_download_token_active_idx
  ON data_subject_export_download_tokens(data_subject_job_id, requested_by)
  WHERE used_at IS NULL;
CREATE INDEX data_subject_export_download_token_lookup_idx
  ON data_subject_export_download_tokens(tenant_id, project_id, data_subject_job_id, requested_by, expires_at);

COMMIT;
