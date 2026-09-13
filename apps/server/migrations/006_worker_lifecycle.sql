-- Durable worker contracts.  A web request may enqueue work but never needs a
-- running worker to commit its own transaction.  Workers only claim a short,
-- renewable lease and every externally visible operation has an idempotency key.
BEGIN;

CREATE TABLE outbox_messages (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  topic text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 10,
  delivered_at timestamptz,
  discarded_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, topic, idempotency_key),
  CHECK (length(topic) BETWEEN 1 AND 100),
  CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 100),
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);
CREATE INDEX outbox_claim_idx ON outbox_messages (available_at, id)
  WHERE delivered_at IS NULL AND discarded_at IS NULL;
CREATE INDEX outbox_lease_expiry_idx ON outbox_messages (lease_expires_at, id)
  WHERE delivered_at IS NULL AND discarded_at IS NULL AND lease_expires_at IS NOT NULL;

CREATE TABLE outbox_attempts (
  id uuid PRIMARY KEY,
  outbox_id uuid NOT NULL REFERENCES outbox_messages(id) ON DELETE RESTRICT,
  worker_id text NOT NULL,
  attempt_number integer NOT NULL,
  outcome text NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, attempt_number),
  CHECK (length(worker_id) BETWEEN 1 AND 200),
  CHECK (outcome IN ('delivered', 'retry_scheduled', 'discarded', 'lease_released')),
  CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 100)
);
CREATE INDEX outbox_attempts_outbox_idx ON outbox_attempts (outbox_id, created_at DESC);

CREATE TABLE worker_jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  watermark jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 10,
  processed_count bigint NOT NULL DEFAULT 0,
  failed_count bigint NOT NULL DEFAULT 0,
  last_error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, kind, idempotency_key),
  CHECK (kind IN ('retention_cleanup', 'subject_export', 'subject_deletion', 'project_deletion', 'artifact_cleanup', 'replay_object_cleanup', 'sourcemap_cleanup', 'report_export')),
  CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  CHECK (jsonb_typeof(payload) = 'object' AND jsonb_typeof(watermark) = 'object'),
  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 100),
  CHECK (processed_count >= 0 AND failed_count >= 0),
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((status = 'running') = (lease_owner IS NOT NULL)),
  CHECK ((status IN ('succeeded', 'failed', 'cancelled')) = (finished_at IS NOT NULL))
);
CREATE INDEX worker_jobs_claim_idx ON worker_jobs (available_at, id)
  WHERE status IN ('queued', 'running');
CREATE INDEX worker_jobs_scope_idx ON worker_jobs (tenant_id, project_id, created_at DESC, id DESC);

CREATE TABLE worker_job_runs (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES worker_jobs(id) ON DELETE RESTRICT,
  worker_id text NOT NULL,
  attempt_number integer NOT NULL,
  outcome text NOT NULL,
  processed_count bigint NOT NULL DEFAULT 0,
  failed_count bigint NOT NULL DEFAULT 0,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, attempt_number),
  CHECK (length(worker_id) BETWEEN 1 AND 200),
  CHECK (outcome IN ('succeeded', 'retry_scheduled', 'failed', 'lease_released')),
  CHECK (processed_count >= 0 AND failed_count >= 0),
  CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 100)
);
CREATE INDEX worker_job_runs_job_idx ON worker_job_runs (job_id, created_at DESC);

-- Tombstones are never deleted by a lifecycle retry.  Restore tooling must
-- replay them before exposing restored data, even after its linked job ends.
CREATE TABLE deletion_tombstones (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  subject_business_user_id text,
  project_deletion boolean NOT NULL DEFAULT false,
  deletion_job_id uuid REFERENCES worker_jobs(id) ON DELETE RESTRICT,
  effective_at timestamptz NOT NULL DEFAULT now(),
  backup_expiry_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((subject_business_user_id IS NOT NULL) <> project_deletion),
  CHECK (subject_business_user_id IS NULL OR length(subject_business_user_id) BETWEEN 1 AND 200),
  CHECK (backup_expiry_at > effective_at)
);
CREATE UNIQUE INDEX deletion_tombstones_subject_unique ON deletion_tombstones (tenant_id, project_id, subject_business_user_id)
  WHERE subject_business_user_id IS NOT NULL;
CREATE UNIQUE INDEX deletion_tombstones_project_unique ON deletion_tombstones (tenant_id, project_id)
  WHERE project_deletion;

COMMIT;
