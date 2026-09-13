BEGIN;

CREATE TABLE sso_connections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  issuer text NOT NULL,
  client_id text NOT NULL,
  client_secret_encrypted bytea NOT NULL,
  discovery_document_version text,
  allowed_email_domains text[] NOT NULL DEFAULT '{}',
  default_role text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, issuer),
  CHECK (issuer ~ '^https://'),
  CHECK (length(client_id) BETWEEN 1 AND 1024),
  CHECK (octet_length(client_secret_encrypted) >= 28),
  CHECK (default_role IN ('admin', 'member', 'viewer'))
);

CREATE TABLE sso_identities (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  email_normalized text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, issuer, subject),
  UNIQUE (tenant_id, issuer, user_id),
  CHECK (length(subject) BETWEEN 1 AND 1024),
  CHECK (length(email_normalized) BETWEEN 3 AND 320)
);
CREATE INDEX sso_identities_user_idx ON sso_identities (user_id);

CREATE TABLE sso_authorization_transactions (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES sso_connections(id) ON DELETE RESTRICT,
  state_hash bytea NOT NULL UNIQUE,
  nonce text NOT NULL,
  pkce_verifier_encrypted bytea NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(state_hash) = 32),
  CHECK (length(nonce) BETWEEN 32 AND 512),
  CHECK (octet_length(pkce_verifier_encrypted) >= 28),
  CHECK (expires_at > created_at)
);
CREATE INDEX sso_authorization_transactions_active_idx ON sso_authorization_transactions (connection_id, expires_at) WHERE consumed_at IS NULL;

COMMIT;
