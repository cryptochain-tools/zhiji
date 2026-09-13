-- Usage is derived from accepted receipts.  Retaining the canonical byte count
-- on each accepted receipt makes this aggregate safe to rebuild without joining
-- identities (where a visitor can legitimately have multiple associations).
BEGIN;

ALTER TABLE ingest_receipts ADD COLUMN received_bytes integer;
ALTER TABLE ingest_receipts ADD CONSTRAINT ingest_receipts_received_bytes_check
  CHECK (received_bytes IS NULL OR received_bytes >= 0);

CREATE TABLE usage_ledger_daily (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  usage_date date NOT NULL,
  lane text NOT NULL,
  received_events bigint NOT NULL DEFAULT 0,
  received_bytes bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, usage_date, lane),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (lane IN ('analytics', 'error', 'behavior', 'replay', 'performance')),
  CHECK (received_events >= 0),
  CHECK (received_bytes >= 0)
);
CREATE INDEX usage_ledger_daily_project_date_idx
  ON usage_ledger_daily (tenant_id, project_id, usage_date DESC, lane);

COMMIT;
