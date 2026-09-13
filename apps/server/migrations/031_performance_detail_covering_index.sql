-- Page-detail performance reads only return aggregate Web Vitals.  This partial
-- covering index narrows the bounded page_key + metric time range without
-- creating an index for observations that cannot have a page detail.
BEGIN;

CREATE INDEX performance_observations_page_detail_idx
  ON performance_observations (tenant_id, project_id, page_key, metric_name, occurred_at DESC)
  INCLUDE (release, navigation_type, value, rating)
  WHERE page_key IS NOT NULL;

COMMIT;
