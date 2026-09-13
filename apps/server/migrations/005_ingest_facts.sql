-- Ingested lane facts.  Receipt insertion and every fact insert are committed
-- by the application in one transaction; these unique keys are a second
-- database-level guard against duplicate delivery.
BEGIN;

ALTER TABLE projects
  ADD COLUMN page_capture jsonb NOT NULL
    DEFAULT '{"allowed_page_keys":[],"route_templates":[]}'::jsonb,
  ADD CONSTRAINT projects_page_capture_object CHECK (jsonb_typeof(page_capture) = 'object');

CREATE TABLE behavior_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  client_event_id uuid NOT NULL,
  visitor_id text NOT NULL,
  business_user_id text,
  page_key text NOT NULL,
  page_version text,
  action text NOT NULL,
  element_key text,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, client_event_id),
  CHECK (action IN ('autocapture_click', 'autocapture_submit', 'autocapture_change', 'scroll_depth', 'rage_click', 'dead_click')),
  CHECK (length(visitor_id) BETWEEN 1 AND 200),
  CHECK (length(page_key) BETWEEN 1 AND 512)
);
CREATE INDEX behavior_events_project_page_occurred_idx ON behavior_events (tenant_id, project_id, page_key, occurred_at DESC);

CREATE TABLE performance_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  client_event_id uuid NOT NULL,
  visitor_id text NOT NULL,
  business_user_id text,
  page_key text NOT NULL,
  metric_name text NOT NULL,
  metric_value double precision NOT NULL,
  metric_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, client_event_id),
  CHECK (metric_name IN ('CLS', 'INP', 'LCP', 'FCP', 'TTFB')),
  CHECK (metric_value >= 0),
  CHECK (length(visitor_id) BETWEEN 1 AND 200),
  CHECK (length(page_key) BETWEEN 1 AND 512),
  CHECK (length(metric_id) BETWEEN 1 AND 128)
);
CREATE INDEX performance_events_project_metric_occurred_idx ON performance_events (tenant_id, project_id, metric_name, occurred_at DESC);

CREATE TABLE replay_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  visitor_id text NOT NULL,
  business_user_id text,
  started_at timestamptz NOT NULL,
  release text,
  policy_version integer NOT NULL,
  initial_route text NOT NULL,
  sample_decision boolean NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, id),
  CHECK (length(visitor_id) BETWEEN 1 AND 200),
  CHECK (policy_version > 0),
  CHECK (length(initial_route) BETWEEN 1 AND 512)
);
CREATE INDEX replay_sessions_project_started_idx ON replay_sessions (tenant_id, project_id, started_at DESC, id DESC);

CREATE TABLE replay_chunks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  session_id uuid NOT NULL,
  client_event_id uuid NOT NULL,
  sequence_start bigint NOT NULL,
  sequence_end bigint NOT NULL,
  encoding text NOT NULL,
  payload text NOT NULL,
  payload_sha256 text NOT NULL,
  occurred_from timestamptz NOT NULL,
  occurred_to timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, session_id) REFERENCES replay_sessions(tenant_id, project_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, client_event_id),
  CHECK (sequence_start >= 0 AND sequence_end >= sequence_start),
  CHECK (encoding IN ('rrweb-json', 'rrweb-json+gzip')),
  CHECK (length(payload) BETWEEN 1 AND 350000),
  CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (occurred_to >= occurred_from)
);
CREATE INDEX replay_chunks_session_sequence_idx ON replay_chunks (tenant_id, project_id, session_id, sequence_start ASC);

COMMIT;
