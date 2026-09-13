BEGIN;
ALTER TABLE notification_targets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS alert_instances_project_created_idx ON alert_instances (tenant_id, project_id, first_triggered_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS notification_deliveries_project_created_idx ON notification_deliveries (tenant_id, project_id, created_at DESC, id DESC);
COMMIT;
