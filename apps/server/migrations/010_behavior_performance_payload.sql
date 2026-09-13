-- Behavior and Web Vitals facts use the SDK's privacy-preserving, structured payload.
BEGIN;

ALTER TABLE behavior_events
  ADD COLUMN release text,
  ADD COLUMN viewport_width integer,
  ADD COLUMN viewport_height integer,
  ADD COLUMN document_width integer,
  ADD COLUMN document_height integer,
  ADD COLUMN client_x integer,
  ADD COLUMN client_y integer,
  ADD COLUMN document_x integer,
  ADD COLUMN document_y integer,
  ADD COLUMN depth_bucket integer,
  ADD COLUMN click_count integer,
  ADD CONSTRAINT behavior_events_coordinates_complete CHECK (
    (viewport_width IS NULL AND viewport_height IS NULL AND document_width IS NULL AND document_height IS NULL AND client_x IS NULL AND client_y IS NULL AND document_x IS NULL AND document_y IS NULL)
    OR
    (viewport_width >= 1 AND viewport_height >= 1 AND document_width >= viewport_width AND document_height >= viewport_height AND client_x >= 0 AND client_y >= 0 AND document_x BETWEEN 0 AND document_width AND document_y BETWEEN 0 AND document_height)
  ),
  ADD CONSTRAINT behavior_events_action_details CHECK (
    (action = 'scroll_depth' AND depth_bucket IN (25, 50, 75, 100) AND click_count IS NULL)
    OR (action = 'rage_click' AND click_count BETWEEN 3 AND 20 AND depth_bucket IS NULL)
    OR (action NOT IN ('scroll_depth', 'rage_click') AND depth_bucket IS NULL AND click_count IS NULL)
  );

CREATE INDEX behavior_events_heatmap_idx
  ON behavior_events (tenant_id, project_id, page_key, action, occurred_at DESC)
  WHERE document_x IS NOT NULL;

COMMIT;
