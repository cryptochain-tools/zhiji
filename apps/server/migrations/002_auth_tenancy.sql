-- Cookie session credentials are random secrets; only their SHA-256 digest is stored.
BEGIN;

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(token_hash) = 32),
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_active_token_idx ON sessions (token_hash, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

COMMIT;
