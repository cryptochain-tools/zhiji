-- Project/Key management invariants which depend on the core tables in 001.
-- Secrets remain application-only: this migration deliberately never stores a
-- plaintext key or an encrypted copy that could be returned later.
BEGIN;

CREATE TABLE project_key_audit (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  key_id uuid NOT NULL,
  action text NOT NULL,
  actor_user_id uuid,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (key_id) REFERENCES project_keys(id) ON DELETE RESTRICT,
  CHECK (action IN ('created', 'disabled', 'rotated'))
);
CREATE INDEX project_key_audit_scope_created_idx
  ON project_key_audit (tenant_id, project_id, created_at DESC, id DESC);

-- Rotation idempotency stores the replacement key identity only. A repeated
-- request may identify the original result but cannot redisplay its secret.
CREATE TABLE project_key_rotation_requests (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  previous_key_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  replacement_key_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, previous_key_id, idempotency_key),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (previous_key_id) REFERENCES project_keys(id) ON DELETE RESTRICT,
  FOREIGN KEY (replacement_key_id) REFERENCES project_keys(id) ON DELETE RESTRICT,
  CHECK (length(idempotency_key) BETWEEN 1 AND 200)
);

COMMIT;
