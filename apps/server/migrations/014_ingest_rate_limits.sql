-- Fixed-window ingest limits are an application safety boundary, not a plan
-- quota. One bounded bucket exists for each active key, project, and lane.
BEGIN;

CREATE TABLE ingest_rate_limit_buckets (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_key_id uuid NOT NULL REFERENCES project_keys(id) ON DELETE RESTRICT,
  lane text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, project_key_id, lane),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (lane IN ('analytics', 'error', 'behavior', 'replay', 'performance')),
  CHECK (request_count >= 0)
);

COMMIT;
