-- 身份关联凭据是短期、一次性且严格绑定项目、visitor 与业务用户的随机不透明值。
BEGIN;

CREATE TABLE identity_assertions (
  id uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  visitor_id text NOT NULL,
  business_user_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  issued_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (octet_length(token_hash) = 32),
  CHECK (length(visitor_id) BETWEEN 1 AND 128),
  CHECK (length(business_user_id) BETWEEN 1 AND 128),
  CHECK (expires_at > created_at)
);
CREATE INDEX identity_assertions_expiry_idx ON identity_assertions (expires_at) WHERE consumed_at IS NULL;

COMMIT;
