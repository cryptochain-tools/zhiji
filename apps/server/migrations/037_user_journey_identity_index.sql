-- User journeys look up every verified visitor belonging to one business user.
-- The identities primary key starts with visitor_id, so this inverse index keeps
-- that bounded project-scoped lookup from scanning the whole identity relation.
BEGIN;

CREATE INDEX identities_project_business_visitor_idx
  ON identities (tenant_id, project_id, business_user_id, visitor_id);

COMMIT;
