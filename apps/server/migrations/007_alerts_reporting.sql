-- Safe alert/report metadata and performance aggregates.  External transport
-- secrets deliberately do not exist in this schema; a deployment-owned secret
-- provider must be added before any target may be enabled.
BEGIN;

CREATE TABLE performance_observations (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  client_event_id uuid NOT NULL, visitor_id text NOT NULL, business_user_id text,
  release text, page_key text, route text, navigation_type text NOT NULL,
  metric_name text NOT NULL, value double precision NOT NULL, rating text NOT NULL,
  metric_id text NOT NULL, viewport_width_bucket integer NOT NULL, viewport_height_bucket integer NOT NULL,
  browser text NOT NULL, device text NOT NULL, occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, client_event_id),
  CHECK (length(visitor_id) BETWEEN 1 AND 200),
  CHECK (metric_name IN ('CLS', 'INP', 'LCP', 'FCP', 'TTFB')),
  CHECK (rating IN ('good', 'needs_improvement', 'poor')),
  CHECK (navigation_type IN ('navigate', 'reload', 'back_forward', 'prerender', 'soft_navigation')),
  CHECK (value NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) AND value >= 0),
  CHECK (viewport_width_bucket >= 0 AND viewport_height_bucket >= 0)
);
CREATE INDEX performance_observations_metric_idx ON performance_observations (tenant_id, project_id, metric_name, occurred_at DESC);
CREATE INDEX performance_observations_page_metric_idx ON performance_observations (tenant_id, project_id, page_key, metric_name, occurred_at DESC);
CREATE INDEX performance_observations_expiry_idx ON performance_observations (received_at, id);

CREATE TABLE performance_metric_daily (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, day date NOT NULL, metric_name text NOT NULL,
  page_key text NOT NULL DEFAULT '', release text NOT NULL DEFAULT '', viewport_width_bucket integer NOT NULL,
  browser text NOT NULL, device text NOT NULL, count bigint NOT NULL DEFAULT 0, good_count bigint NOT NULL DEFAULT 0,
  needs_improvement_count bigint NOT NULL DEFAULT 0, poor_count bigint NOT NULL DEFAULT 0, sum_value double precision NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, day, metric_name, page_key, release, viewport_width_bucket, browser, device),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (count >= 0 AND good_count >= 0 AND needs_improvement_count >= 0 AND poor_count >= 0),
  CHECK (good_count + needs_improvement_count + poor_count = count), CHECK (sum_value NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) AND sum_value >= 0)
);

CREATE TABLE alert_rules (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false, rule_type text NOT NULL, condition_json jsonb NOT NULL,
  targets_version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (length(name) BETWEEN 1 AND 200), CHECK (rule_type IN ('error_new', 'error_regression', 'error_count', 'performance_p75', 'performance_rating')),
  CHECK (jsonb_typeof(condition_json) = 'object'), CHECK (targets_version > 0)
);
CREATE INDEX alert_rules_project_idx ON alert_rules (tenant_id, project_id, created_at DESC, id DESC);

CREATE TABLE notification_targets (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, type text NOT NULL,
  label text NOT NULL, enabled boolean NOT NULL DEFAULT false, config_public jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz, created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (type IN ('lark_bot', 'email', 'webhook')), CHECK (length(label) BETWEEN 1 AND 200),
  CHECK (jsonb_typeof(config_public) = 'object'), CHECK (NOT enabled OR verified_at IS NOT NULL)
);
CREATE INDEX notification_targets_project_idx ON notification_targets (tenant_id, project_id, created_at DESC, id DESC);

CREATE TABLE alert_rule_targets (
  rule_id uuid NOT NULL REFERENCES alert_rules(id) ON DELETE RESTRICT, target_id uuid NOT NULL REFERENCES notification_targets(id) ON DELETE RESTRICT,
  PRIMARY KEY (rule_id, target_id)
);

CREATE TABLE alert_instances (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, rule_id uuid NOT NULL REFERENCES alert_rules(id) ON DELETE RESTRICT,
  group_key text NOT NULL, status text NOT NULL, first_triggered_at timestamptz NOT NULL, last_triggered_at timestamptz NOT NULL,
  last_evaluated_at timestamptz NOT NULL, cooldown_until timestamptz NOT NULL, payload_summary jsonb NOT NULL,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (rule_id, group_key), CHECK (status IN ('active', 'resolved', 'suppressed')),
  CHECK (length(group_key) BETWEEN 1 AND 400), CHECK (jsonb_typeof(payload_summary) = 'object')
);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, alert_instance_id uuid NOT NULL REFERENCES alert_instances(id) ON DELETE RESTRICT,
  target_id uuid NOT NULL REFERENCES notification_targets(id) ON DELETE RESTRICT, status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0, not_before timestamptz NOT NULL DEFAULT now(), lease_expires_at timestamptz,
  last_attempt_at timestamptz, delivered_at timestamptz, last_error_code text, payload_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (alert_instance_id, target_id, payload_version), CHECK (status IN ('queued', 'delivered', 'failed', 'cancelled')),
  CHECK (attempt_count BETWEEN 0 AND 5)
);
CREATE INDEX notification_deliveries_pending_idx ON notification_deliveries (not_before, id) WHERE status = 'queued';

CREATE TABLE analytics_export_jobs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL, format text NOT NULL, definition jsonb NOT NULL, query_hash bytea NOT NULL,
  status text NOT NULL DEFAULT 'queued', row_count integer, byte_count bigint, error_code text, artifact_ref text,
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz, expires_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, requested_by, idempotency_key), CHECK (format IN ('csv', 'xlsx')),
  CHECK (jsonb_typeof(definition) = 'object'), CHECK (octet_length(query_hash) = 32),
  CHECK (status IN ('queued', 'running', 'completed', 'failed', 'expired', 'cancelled')),
  CHECK (expires_at > created_at)
);
CREATE INDEX analytics_export_jobs_expiry_idx ON analytics_export_jobs (expires_at, id);

CREATE TABLE report_schedules (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, target_type text NOT NULL, target_id uuid NOT NULL,
  cadence text NOT NULL, timezone text NOT NULL, next_run_at timestamptz NOT NULL, enabled boolean NOT NULL DEFAULT false,
  notification_target_id uuid NOT NULL REFERENCES notification_targets(id) ON DELETE RESTRICT, created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (target_type IN ('insight', 'dashboard')), CHECK (cadence IN ('daily', 'weekly', 'monthly')), CHECK (length(timezone) BETWEEN 1 AND 100)
);
CREATE TABLE report_runs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, schedule_id uuid NOT NULL REFERENCES report_schedules(id) ON DELETE RESTRICT,
  scheduled_for timestamptz NOT NULL, status text NOT NULL DEFAULT 'queued', definition jsonb NOT NULL,
  query_hash bytea NOT NULL, error_code text, created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (schedule_id, scheduled_for), CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')), CHECK (jsonb_typeof(definition) = 'object'), CHECK (octet_length(query_hash) = 32)
);
COMMIT;
