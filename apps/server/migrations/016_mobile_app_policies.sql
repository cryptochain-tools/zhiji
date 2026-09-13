-- Mobile keys are public identifiers embedded in application packages.  The
-- declared application metadata constrains accidental/misrouted use; it is
-- intentionally not represented as a secret or as cryptographic attestation.
BEGIN;

ALTER TABLE projects
  ADD COLUMN mobile_applications jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE projects
  ADD CONSTRAINT projects_mobile_applications_is_array
  CHECK (jsonb_typeof(mobile_applications) = 'array');

-- One row is retained for every accepted mobile receipt. This makes the weak
-- assurance visible to investigations without changing the canonical facts.
CREATE TABLE mobile_ingest_declarations (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  lane text NOT NULL,
  client_event_id uuid NOT NULL,
  platform text NOT NULL,
  application_id text NOT NULL,
  application_version text NOT NULL,
  verification_level text NOT NULL DEFAULT 'declaration_only',
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, lane, client_event_id),
  FOREIGN KEY (tenant_id, project_id, lane, client_event_id)
    REFERENCES ingest_receipts (tenant_id, project_id, lane, client_event_id)
    ON DELETE CASCADE,
  CHECK (lane IN ('analytics', 'error')),
  CHECK (platform IN ('ios', 'android', 'react_native')),
  CHECK (verification_level = 'declaration_only'),
  CHECK (length(application_id) BETWEEN 1 AND 255),
  CHECK (length(application_version) BETWEEN 1 AND 64)
);
CREATE INDEX mobile_ingest_declarations_project_received_idx
  ON mobile_ingest_declarations (tenant_id, project_id, received_at DESC);

COMMIT;
