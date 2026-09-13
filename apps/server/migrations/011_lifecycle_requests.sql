-- Subject lifecycle requests are intentionally separate from analytics exports.
-- Proof values and artifact locations never enter these tables or audit records.
BEGIN;

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CHECK (length(action) BETWEEN 1 AND 100),
  CHECK (length(target_type) BETWEEN 1 AND 100),
  CHECK (length(target_id) BETWEEN 1 AND 200),
  CHECK (request_id IS NULL OR length(request_id) BETWEEN 1 AND 200),
  CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX audit_logs_tenant_created_idx ON audit_logs (tenant_id, created_at DESC, id DESC);

CREATE TABLE data_subject_jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subject_business_user_id text NOT NULL,
  verification_method text NOT NULL,
  reauthenticated_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  scope_hash bytea NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz NOT NULL,
  reason_code text,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, requested_by, kind, idempotency_key),
  CHECK (kind IN ('subject_export', 'subject_deletion')),
  CHECK (length(subject_business_user_id) BETWEEN 1 AND 200),
  CHECK (length(verification_method) BETWEEN 1 AND 100),
  CHECK (octet_length(scope_hash) = 32),
  CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  CHECK (status IN ('queued', 'running', 'completed', 'failed', 'expired', 'cancelled')),
  CHECK (expires_at > created_at),
  CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 100)
);
CREATE INDEX data_subject_jobs_scope_idx ON data_subject_jobs (tenant_id, project_id, created_at DESC, id DESC);
CREATE INDEX data_subject_jobs_expiry_idx ON data_subject_jobs (expires_at, id) WHERE status IN ('queued', 'running', 'completed');

ALTER TABLE projects
  ADD COLUMN deletion_status text NOT NULL DEFAULT 'active',
  ADD COLUMN deletion_requested_at timestamptz,
  ADD COLUMN deletion_effective_at timestamptz,
  ADD COLUMN deletion_cancelled_at timestamptz,
  ADD CONSTRAINT projects_deletion_status_check CHECK (deletion_status IN ('active', 'pending', 'deleting', 'deleted')),
  ADD CONSTRAINT projects_deletion_timing_check CHECK (
    (deletion_status = 'active' AND deletion_requested_at IS NULL AND deletion_effective_at IS NULL)
    OR (deletion_status IN ('pending', 'deleting', 'deleted') AND deletion_requested_at IS NOT NULL AND deletion_effective_at IS NOT NULL)
  );

CREATE TABLE project_deletion_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verification_method text NOT NULL,
  reauthenticated_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  effective_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, requested_by, idempotency_key),
  CHECK (length(verification_method) BETWEEN 1 AND 100),
  CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled')),
  CHECK (effective_at > created_at)
);
CREATE UNIQUE INDEX project_deletion_requests_active_unique ON project_deletion_requests (tenant_id, project_id)
  WHERE status IN ('pending', 'queued', 'running');

-- These locks distinguish keys frozen by a cancellable project deletion from
-- keys an operator had already disabled for an unrelated reason.
CREATE TABLE project_deletion_key_locks (
  deletion_request_id uuid NOT NULL REFERENCES project_deletion_requests(id) ON DELETE RESTRICT,
  key_id uuid NOT NULL REFERENCES project_keys(id) ON DELETE RESTRICT,
  disabled_at timestamptz NOT NULL,
  restored_at timestamptz,
  PRIMARY KEY (deletion_request_id, key_id)
);

COMMIT;
