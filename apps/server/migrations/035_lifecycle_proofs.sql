BEGIN;

CREATE TABLE lifecycle_proofs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('subject_export', 'subject_deletion', 'project_deletion')),
  subject_business_user_id text,
  purpose_hash bytea NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  verification_method text NOT NULL DEFAULT 'owner_reauthenticated',
  reauthenticated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE,
  CHECK (octet_length(purpose_hash) = 32),
  CHECK (octet_length(token_hash) = 32),
  CHECK (expires_at > reauthenticated_at),
  CHECK (
    (operation = 'project_deletion' AND subject_business_user_id IS NULL)
    OR (operation IN ('subject_export', 'subject_deletion') AND length(subject_business_user_id) BETWEEN 1 AND 200)
  )
);

CREATE INDEX lifecycle_proofs_expiry_idx ON lifecycle_proofs (expires_at);

CREATE TABLE lifecycle_proof_rate_limits (
  actor_user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 1000000),
  updated_at timestamptz NOT NULL
);

COMMIT;
