BEGIN;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'xlsx' CHECK (format IN ('csv','xlsx'));
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS artifact_ref text;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS row_count integer;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS byte_count bigint;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS delivery_id uuid;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 3);
CREATE INDEX IF NOT EXISTS report_schedules_due_idx ON report_schedules (next_run_at, id) WHERE enabled;
CREATE INDEX IF NOT EXISTS report_runs_schedule_idx ON report_runs (schedule_id, scheduled_for DESC, id DESC);
CREATE TABLE IF NOT EXISTS report_run_deliveries (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  report_run_id uuid NOT NULL REFERENCES report_runs(id) ON DELETE RESTRICT,
  target_id uuid NOT NULL REFERENCES notification_targets(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'queued', attempt_count integer NOT NULL DEFAULT 0,
  not_before timestamptz NOT NULL DEFAULT now(), lease_expires_at timestamptz,
  last_attempt_at timestamptz, delivered_at timestamptz, last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id,id) ON DELETE RESTRICT,
  UNIQUE (report_run_id, target_id), CHECK (status IN ('queued','delivered','failed','cancelled')), CHECK (attempt_count BETWEEN 0 AND 5)
);
CREATE INDEX IF NOT EXISTS report_run_deliveries_pending_idx ON report_run_deliveries (not_before,id) WHERE status='queued';
COMMIT;
