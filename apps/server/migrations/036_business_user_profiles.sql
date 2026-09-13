-- Server-key managed business-user directory. Contact fields live here rather
-- than in event properties so access, retention, and deletion stay explicit.
BEGIN;

CREATE TABLE business_user_profiles (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  business_user_id text NOT NULL,
  email_normalized text NOT NULL,
  display_name text,
  department text,
  role text,
  is_active boolean NOT NULL DEFAULT true,
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, business_user_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CHECK (length(business_user_id) BETWEEN 1 AND 128),
  CHECK (length(email_normalized) BETWEEN 3 AND 320),
  CHECK (email_normalized = lower(email_normalized)),
  CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 200),
  CHECK (department IS NULL OR length(department) BETWEEN 1 AND 200),
  CHECK (role IS NULL OR length(role) BETWEEN 1 AND 100)
);

CREATE INDEX business_user_profiles_project_email_idx
  ON business_user_profiles (tenant_id, project_id, email_normalized);
CREATE INDEX business_user_profiles_project_active_idx
  ON business_user_profiles (tenant_id, project_id, is_active, updated_at DESC);

COMMIT;
