-- 知迹核心隔离边界。由受控 migration runner 在独立 PostgreSQL 数据库执行，
-- 不由应用启动自动执行；UUID 在应用层生成，故此迁移不安装扩展。
BEGIN;

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email_normalized text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(email_normalized) BETWEEN 3 AND 320),
  CHECK (length(display_name) BETWEEN 1 AND 200)
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  retention_days integer NOT NULL DEFAULT 365,
  event_quota integer NOT NULL DEFAULT 100000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(name) BETWEEN 1 AND 200),
  CHECK (retention_days > 0),
  CHECK (event_quota > 0),
  UNIQUE (id)
);

CREATE TABLE memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  CHECK (role IN ('owner', 'admin', 'member', 'viewer'))
);
CREATE INDEX memberships_user_tenant_idx ON memberships (user_id, tenant_id);

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name text NOT NULL,
  allowed_origins jsonb NOT NULL DEFAULT '[]'::jsonb,
  core_event_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  retention_days integer,
  event_quota integer,
  behavior_capture jsonb NOT NULL DEFAULT '{"enabled":false,"policy_version":1}'::jsonb,
  session_replay jsonb NOT NULL DEFAULT '{"enabled":false,"policy_version":1,"sample_rate":0,"page_allowlist":[],"max_session_seconds":0,"max_session_bytes":0}'::jsonb,
  performance_capture jsonb NOT NULL DEFAULT '{"enabled":false,"policy_version":1}'::jsonb,
  policy_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (length(name) BETWEEN 1 AND 200),
  CHECK (retention_days IS NULL OR retention_days > 0),
  CHECK (event_quota IS NULL OR event_quota > 0),
  CHECK (policy_version > 0),
  CHECK (jsonb_typeof(allowed_origins) = 'array'),
  CHECK (jsonb_typeof(core_event_names) = 'array'),
  CHECK (jsonb_typeof(behavior_capture) = 'object'),
  CHECK (jsonb_typeof(session_replay) = 'object'),
  CHECK (jsonb_typeof(performance_capture) = 'object')
);
CREATE INDEX projects_tenant_created_idx ON projects (tenant_id, created_at DESC, id DESC);

CREATE TABLE project_keys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  key_type text NOT NULL,
  label text NOT NULL,
  prefix text NOT NULL,
  key_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (key_type IN ('browser', 'server', 'mobile', 'otel', 'sourcemap_upload')),
  CHECK (length(label) BETWEEN 1 AND 200),
  CHECK (length(prefix) BETWEEN 6 AND 32),
  CHECK (octet_length(key_hash) = 32)
);
CREATE UNIQUE INDEX project_keys_key_hash_unique ON project_keys (key_hash);
CREATE INDEX project_keys_project_active_idx ON project_keys (tenant_id, project_id, created_at DESC)
  WHERE disabled_at IS NULL;

CREATE TABLE ingest_receipts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  lane text NOT NULL,
  client_event_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  decision text NOT NULL,
  PRIMARY KEY (tenant_id, project_id, lane, client_event_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (lane IN ('analytics', 'error', 'behavior', 'replay', 'performance')),
  CHECK (decision IN ('accepted', 'sampled', 'rate_limited', 'dropped', 'duplicate'))
);
CREATE INDEX ingest_receipts_expiry_idx ON ingest_receipts (received_at);

-- 部署级运行开关只有一个受约束的单行记录；敏感凭据继续留在 EnvironmentFile/secret store。
CREATE TABLE runtime_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  worker_enabled boolean NOT NULL DEFAULT false,
  sdk_config_max_age_seconds integer NOT NULL DEFAULT 300,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sdk_config_max_age_seconds BETWEEN 0 AND 3600)
);
INSERT INTO runtime_config (singleton) VALUES (true);

COMMIT;
