-- Saved dynamic cohorts and bounded, non-identifying calculation snapshots.
BEGIN;

CREATE TABLE cohorts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  subject_kind text NOT NULL,
  definition jsonb NOT NULL,
  definition_version integer NOT NULL DEFAULT 1,
  visibility text NOT NULL DEFAULT 'project',
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, id),
  CHECK (length(name) BETWEEN 1 AND 200),
  CHECK (description IS NULL OR length(description) <= 2000),
  CHECK (subject_kind IN ('visitor', 'business_user')),
  CHECK (visibility IN ('private', 'project')),
  CHECK (definition_version > 0),
  CHECK (jsonb_typeof(definition) = 'object')
);
CREATE UNIQUE INDEX cohorts_active_project_name_unique ON cohorts (tenant_id, project_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX cohorts_active_visible_idx ON cohorts (tenant_id, project_id, visibility, created_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX cohorts_active_creator_idx ON cohorts (tenant_id, project_id, created_by, created_at DESC, id DESC) WHERE archived_at IS NULL;

CREATE TABLE cohort_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  definition_version integer NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  range_from timestamptz NOT NULL,
  range_to timestamptz NOT NULL,
  subject_kind text NOT NULL,
  member_count bigint NOT NULL,
  query_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, cohort_id) REFERENCES cohorts(tenant_id, project_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, cohort_id, definition_version, range_from, range_to),
  CHECK (definition_version > 0),
  CHECK (range_from < range_to),
  CHECK (subject_kind IN ('visitor', 'business_user')),
  CHECK (member_count >= 0),
  CHECK (octet_length(query_hash) = 32),
  CHECK (expires_at > calculated_at)
);
CREATE INDEX cohort_snapshots_expiry_idx ON cohort_snapshots (expires_at, id);
CREATE INDEX cohort_snapshots_cohort_idx ON cohort_snapshots (tenant_id, project_id, cohort_id, calculated_at DESC, id DESC);

COMMIT;
