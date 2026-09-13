-- Tenant invitations are one-time credentials.  Their raw token is never kept
-- in this table; delivery receives an encrypted envelope through the outbox.
BEGIN;

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  email_normalized text NOT NULL,
  role text NOT NULL,
  invited_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(email_normalized) BETWEEN 3 AND 320),
  CHECK (role IN ('admin', 'member', 'viewer')),
  CHECK (octet_length(token_hash) = 32),
  CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  CHECK (expires_at > created_at),
  CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL))
);
-- Expiry is evaluated while creating an invitation (and expired rows are
-- revoked). A partial index cannot depend on now(), so pending rows remain
-- unique until that transaction performs the explicit revocation.
CREATE UNIQUE INDEX invitations_pending_email_unique
  ON invitations (tenant_id, email_normalized)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX invitations_actor_idempotency_unique
  ON invitations (tenant_id, invited_by_user_id, idempotency_key);
CREATE INDEX invitations_token_hash_active_idx ON invitations (token_hash)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Invitations exist before a tenant has an analytics project.  Tenant-level
-- mail work therefore has no project scope; project-scoped messages retain the
-- original FK and uniqueness contract.
ALTER TABLE outbox_messages ALTER COLUMN project_id DROP NOT NULL;
CREATE UNIQUE INDEX outbox_tenant_topic_idempotency_unique
  ON outbox_messages (tenant_id, topic, idempotency_key)
  WHERE project_id IS NULL;

COMMIT;
