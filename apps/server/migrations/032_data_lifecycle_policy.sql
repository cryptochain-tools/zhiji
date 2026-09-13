BEGIN;

ALTER TABLE tenants ADD COLUMN data_lifecycle_policy jsonb;
ALTER TABLE projects ADD COLUMN data_lifecycle_policy jsonb;

UPDATE tenants
SET data_lifecycle_policy = jsonb_build_object(
  'raw_event_days', retention_days,
  'error_occurrence_days', LEAST(retention_days, 90),
  'behavior_raw_days', LEAST(retention_days, 14),
  'replay_raw_days', LEAST(retention_days, 7),
  'performance_raw_days', LEAST(retention_days, 30),
  'aggregate_days', retention_days,
  'backup_expiry_days', 30
);

ALTER TABLE tenants ALTER COLUMN data_lifecycle_policy SET NOT NULL;
ALTER TABLE tenants ADD CONSTRAINT tenants_data_lifecycle_policy_object CHECK (jsonb_typeof(data_lifecycle_policy) = 'object');
ALTER TABLE projects ADD CONSTRAINT projects_data_lifecycle_policy_object CHECK (data_lifecycle_policy IS NULL OR jsonb_typeof(data_lifecycle_policy) = 'object');

COMMIT;
