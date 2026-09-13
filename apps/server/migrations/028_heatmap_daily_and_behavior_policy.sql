-- Privacy-preserving behavior details and query-efficient daily heatmap bins.
-- `element_key` remains an opaque server-side HMAC; neither source token nor
-- any selector/DOM attribute is persisted in this schema.
BEGIN;

ALTER TABLE behavior_events
  ADD COLUMN control_type text,
  ADD COLUMN dead_click_heuristic text,
  ADD CONSTRAINT behavior_events_control_type_shape CHECK (
    (action = 'autocapture_change' AND control_type IN ('input', 'select', 'textarea'))
    OR (action <> 'autocapture_change' AND control_type IS NULL)
  ),
  ADD CONSTRAINT behavior_events_dead_click_heuristic_shape CHECK (
    (action = 'dead_click' AND dead_click_heuristic = 'no_navigation_or_interaction_v1')
    OR (action <> 'dead_click' AND dead_click_heuristic IS NULL)
  );

-- Existing disabled policies become the complete fail-closed shape. Existing
-- enabled legacy rows are disabled until an owner/admin explicitly supplies
-- its allowlists; silently guessing a tracking allowlist would widen capture.
UPDATE projects
SET behavior_capture = jsonb_build_object(
  'enabled', false,
  'policy_version', COALESCE((behavior_capture->>'policy_version')::integer, 1),
  'page_allowlist', '[]'::jsonb,
  'track_ids', '[]'::jsonb,
  'block_selectors', '[]'::jsonb,
  'sample_rate', 0
)
WHERE NOT (
  jsonb_typeof(behavior_capture->'page_allowlist') = 'array'
  AND jsonb_typeof(behavior_capture->'track_ids') = 'array'
  AND jsonb_typeof(behavior_capture->'block_selectors') = 'array'
  AND jsonb_typeof(behavior_capture->'sample_rate') = 'number'
);

CREATE TABLE heatmap_bins_daily (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  occurred_on date NOT NULL,
  page_key text NOT NULL,
  -- Empty is the only stored representation of an absent page version so the
  -- compound primary key remains a real uniqueness constraint.
  page_version text NOT NULL DEFAULT '',
  viewport_width_bucket integer NOT NULL,
  action text NOT NULL,
  bin_x smallint NOT NULL,
  bin_y smallint NOT NULL,
  event_count bigint NOT NULL,
  PRIMARY KEY (tenant_id, project_id, occurred_on, page_key, page_version, viewport_width_bucket, action, bin_x, bin_y),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (length(page_key) BETWEEN 1 AND 512),
  CHECK (length(page_version) <= 200),
  CHECK (viewport_width_bucket BETWEEN 0 AND 1000000),
  CHECK (action IN ('autocapture_click', 'autocapture_submit', 'autocapture_change', 'scroll_depth', 'rage_click', 'dead_click')),
  -- Scroll-depth bins use x=-1 and y=25/50/75/100. Coordinate actions use a
  -- 24 x 24 normalized grid.
  CHECK ((action = 'scroll_depth' AND bin_x = -1 AND bin_y IN (25, 50, 75, 100))
    OR (action <> 'scroll_depth' AND bin_x BETWEEN 0 AND 23 AND bin_y BETWEEN 0 AND 23)),
  CHECK (event_count > 0)
);
CREATE INDEX heatmap_bins_daily_series_idx
  ON heatmap_bins_daily (tenant_id, project_id, page_key, page_version, viewport_width_bucket, action, occurred_on DESC);

CREATE TABLE heatmap_series_daily (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  occurred_on date NOT NULL,
  page_key text NOT NULL,
  page_version text NOT NULL DEFAULT '',
  viewport_width_bucket integer NOT NULL,
  action text NOT NULL,
  sample_count bigint NOT NULL,
  first_occurred_at timestamptz NOT NULL,
  last_occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, occurred_on, page_key, page_version, viewport_width_bucket, action),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (length(page_key) BETWEEN 1 AND 512),
  CHECK (length(page_version) <= 200),
  CHECK (viewport_width_bucket BETWEEN 0 AND 1000000),
  CHECK (action IN ('autocapture_click', 'autocapture_submit', 'autocapture_change', 'scroll_depth', 'rage_click', 'dead_click')),
  CHECK (sample_count > 0),
  CHECK (last_occurred_at >= first_occurred_at)
);
CREATE INDEX heatmap_series_daily_lookup_idx
  ON heatmap_series_daily (tenant_id, project_id, page_key, page_version, viewport_width_bucket, occurred_on DESC);

-- A reviewed screenshot is optional. The opaque private artifact reference is
-- deliberately never returned as a public URL by the heatmap API.
CREATE TABLE heatmap_screenshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  page_key text NOT NULL,
  page_version text NOT NULL DEFAULT '',
  viewport_width_bucket integer NOT NULL,
  artifact_ref text NOT NULL,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, project_id, page_key, page_version, viewport_width_bucket),
  CHECK (length(page_key) BETWEEN 1 AND 512),
  CHECK (length(page_version) <= 200),
  CHECK (viewport_width_bucket BETWEEN 0 AND 1000000),
  CHECK (length(artifact_ref) BETWEEN 1 AND 1024)
);

COMMIT;
