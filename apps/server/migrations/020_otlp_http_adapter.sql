-- OTLP is intentionally projected into the existing error/performance facts.
-- The adapter may write only SPAN_DURATION; browser Web-Vitals validation does
-- not accept that metric name.
BEGIN;

ALTER TABLE performance_observations
  DROP CONSTRAINT performance_observations_metric_name_check,
  ADD CONSTRAINT performance_observations_metric_name_check
  CHECK (metric_name IN ('CLS', 'INP', 'LCP', 'FCP', 'TTFB', 'SPAN_DURATION'));

COMMIT;
