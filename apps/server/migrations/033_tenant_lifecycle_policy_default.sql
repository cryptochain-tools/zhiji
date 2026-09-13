BEGIN;

-- New tenants are created by the registration flow after migration 032.
-- Keep its lifecycle policy explicit so registration remains atomic.
ALTER TABLE tenants
  ALTER COLUMN data_lifecycle_policy
  SET DEFAULT '{"raw_event_days":365,"error_occurrence_days":90,"behavior_raw_days":14,"replay_raw_days":7,"performance_raw_days":30,"aggregate_days":365,"backup_expiry_days":30}'::jsonb;

COMMIT;
