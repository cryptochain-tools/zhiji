BEGIN;

CREATE TABLE project_memberships (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, user_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX project_memberships_user_idx ON project_memberships (tenant_id, user_id, project_id);

-- Preserve the visibility existing non-owner members had before project-level access existed.
INSERT INTO project_memberships (tenant_id, project_id, user_id, created_by)
SELECT memberships.tenant_id, projects.id, memberships.user_id, NULL
FROM memberships
JOIN projects ON projects.tenant_id = memberships.tenant_id
WHERE memberships.role <> 'owner';

COMMIT;
