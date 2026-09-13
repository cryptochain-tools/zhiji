-- Error and analytics facts.  All project scoped relations retain tenant_id so
-- PostgreSQL rejects accidental cross-project attachment before application code.
BEGIN;

CREATE TABLE events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  client_event_id uuid NOT NULL,
  client_instance_id uuid NOT NULL,
  client_sequence bigint NOT NULL,
  name text NOT NULL,
  visitor_id text NOT NULL,
  business_user_id text,
  url text,
  route text,
  browser jsonb NOT NULL DEFAULT '{}'::jsonb,
  device jsonb NOT NULL DEFAULT '{}'::jsonb,
  release text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, client_event_id),
  CHECK (length(name) BETWEEN 1 AND 200),
  CHECK (length(visitor_id) BETWEEN 1 AND 200),
  CHECK (client_sequence >= 0),
  CHECK (jsonb_typeof(browser) = 'object'),
  CHECK (jsonb_typeof(device) = 'object'),
  CHECK (jsonb_typeof(properties) = 'object')
);
CREATE INDEX events_project_occurred_idx ON events (tenant_id, project_id, occurred_at DESC);
CREATE INDEX events_project_name_occurred_idx ON events (tenant_id, project_id, name, occurred_at DESC);
CREATE INDEX events_project_visitor_occurred_idx ON events (tenant_id, project_id, visitor_id, occurred_at DESC);
CREATE INDEX events_project_business_user_occurred_idx ON events (tenant_id, project_id, business_user_id, occurred_at DESC)
  WHERE business_user_id IS NOT NULL;

CREATE TABLE identities (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  visitor_id text NOT NULL,
  business_user_id text NOT NULL,
  traits jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_login_at timestamptz NOT NULL,
  last_login_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  PRIMARY KEY (tenant_id, project_id, visitor_id, business_user_id),
  CHECK (length(visitor_id) BETWEEN 1 AND 200),
  CHECK (length(business_user_id) BETWEEN 1 AND 200),
  CHECK (jsonb_typeof(traits) = 'object')
);

CREATE TABLE error_groups (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  fingerprint_algorithm_version text NOT NULL,
  fingerprint bytea NOT NULL,
  status text NOT NULL DEFAULT 'unresolved',
  type text NOT NULL,
  display_message text NOT NULL,
  canonical_stack text,
  release text,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  occurrence_count bigint NOT NULL DEFAULT 0,
  resolved_at timestamptz,
  state_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, fingerprint_algorithm_version, fingerprint),
  UNIQUE (tenant_id, project_id, id),
  CHECK (status IN ('unresolved', 'resolved', 'ignored')),
  CHECK (length(fingerprint_algorithm_version) BETWEEN 1 AND 100),
  CHECK (octet_length(fingerprint) = 32),
  CHECK (length(type) BETWEEN 1 AND 200),
  CHECK (length(display_message) BETWEEN 1 AND 4096),
  CHECK (occurrence_count >= 0),
  CHECK (state_version >= 0)
);
CREATE INDEX error_groups_project_status_seen_idx ON error_groups (tenant_id, project_id, status, last_seen DESC, id DESC);
CREATE INDEX error_groups_project_release_seen_idx ON error_groups (tenant_id, project_id, release, last_seen DESC, id DESC);

CREATE TABLE error_occurrences (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  group_id uuid NOT NULL,
  client_event_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  visitor_id text NOT NULL,
  business_user_id text,
  release text,
  dist text,
  replay_session_id uuid,
  url text,
  route text,
  browser jsonb NOT NULL DEFAULT '{}'::jsonb,
  device jsonb NOT NULL DEFAULT '{}'::jsonb,
  mechanism text,
  stack text,
  frames jsonb NOT NULL DEFAULT '[]'::jsonb,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, group_id) REFERENCES error_groups(tenant_id, project_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, client_event_id),
  CHECK (length(visitor_id) BETWEEN 1 AND 200),
  CHECK (jsonb_typeof(browser) = 'object'),
  CHECK (jsonb_typeof(device) = 'object'),
  CHECK (jsonb_typeof(frames) = 'array')
);
CREATE INDEX error_occurrences_group_occurred_idx ON error_occurrences (tenant_id, project_id, group_id, occurred_at DESC, id DESC);
CREATE INDEX error_occurrences_project_occurred_idx ON error_occurrences (tenant_id, project_id, occurred_at DESC);

CREATE TABLE error_state_history (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  group_id uuid NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, group_id) REFERENCES error_groups(tenant_id, project_id, id) ON DELETE RESTRICT,
  CHECK (from_status IN ('unresolved', 'resolved', 'ignored')),
  CHECK (to_status IN ('unresolved', 'resolved', 'ignored')),
  CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 512)
);
CREATE INDEX error_state_history_group_occurred_idx ON error_state_history (tenant_id, project_id, group_id, occurred_at DESC, id DESC);

COMMIT;
