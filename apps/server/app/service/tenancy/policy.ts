import { MembershipRole } from '../database/types'

export type TenantAction = 'read' | 'manage_members' | 'manage_admins' | 'manage_project_access' | 'manage_projects' | 'manage_settings' | 'manage_keys' | 'update_error_state'

const grants: Record<MembershipRole, readonly TenantAction[]> = {
  owner: [ 'read', 'manage_members', 'manage_admins', 'manage_project_access', 'manage_projects', 'manage_settings', 'manage_keys', 'update_error_state' ],
  admin: [ 'read', 'manage_members', 'manage_projects', 'manage_settings', 'manage_keys', 'update_error_state' ],
  member: [ 'read', 'update_error_state' ],
  viewer: [ 'read' ],
}

export function can(role: MembershipRole, action: TenantAction): boolean { return grants[role].includes(action) }

/** Admin may only add or edit the two non-privileged roles. */
export function canAssignRole(actor: MembershipRole, target: MembershipRole): boolean {
  return actor === 'owner' || (actor === 'admin' && (target === 'member' || target === 'viewer'))
}

export function roleActions(role: MembershipRole): readonly TenantAction[] { return grants[role] }
