-- Versioned, project-scoped saved analytics definitions and dashboard layouts.
-- Definitions contain only validated query metadata; they never contain result rows.
BEGIN;

CREATE TABLE saved_insights (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  kind text NOT NULL,
  definition jsonb NOT NULL,
  definition_version integer NOT NULL DEFAULT 1,
  visibility text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, id),
  CHECK (length(name) BETWEEN 1 AND 200),
  CHECK (description IS NULL OR length(description) <= 2000),
  CHECK (kind IN ('trend', 'funnel', 'retention', 'path')),
  CHECK (visibility IN ('private', 'project')),
  CHECK (definition_version > 0),
  CHECK (jsonb_typeof(definition) = 'object')
);
CREATE INDEX saved_insights_visible_idx ON saved_insights (tenant_id, project_id, visibility, created_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX saved_insights_creator_idx ON saved_insights (tenant_id, project_id, created_by, created_at DESC, id DESC) WHERE archived_at IS NULL;

CREATE TABLE dashboards (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  visibility text NOT NULL DEFAULT 'project',
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, id),
  CHECK (length(name) BETWEEN 1 AND 200),
  CHECK (description IS NULL OR length(description) <= 2000),
  CHECK (visibility = 'project'),
  CHECK (version > 0)
);
CREATE INDEX dashboards_active_idx ON dashboards (tenant_id, project_id, created_at DESC, id DESC) WHERE archived_at IS NULL;

CREATE TABLE dashboard_tiles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  dashboard_id uuid NOT NULL,
  saved_insight_id uuid NOT NULL,
  position integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  title_override text,
  tile_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id, dashboard_id) REFERENCES dashboards(tenant_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, project_id, saved_insight_id) REFERENCES saved_insights(tenant_id, project_id, id) ON DELETE RESTRICT,
  UNIQUE (dashboard_id, id),
  UNIQUE (dashboard_id, position),
  CHECK (position >= 0 AND position < 24),
  CHECK (width BETWEEN 1 AND 12),
  CHECK (height BETWEEN 1 AND 12),
  CHECK (title_override IS NULL OR length(title_override) BETWEEN 1 AND 200),
  CHECK (tile_version > 0)
);
CREATE INDEX dashboard_tiles_dashboard_idx ON dashboard_tiles (tenant_id, project_id, dashboard_id, position);

COMMIT;
