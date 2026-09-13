import { randomUUID } from 'node:crypto'
import { DatabasePool } from '../database/types'
import type { DataLifecyclePolicy } from '@zhiji/contracts'
import { MemberAccessRecord, MemberAccountCreationInput, MemberAccountCreationResult, MembershipRecord, TenantDefaults, TenancyRepository } from './types'

export class PostgresTenancyRepository implements TenancyRepository {
  constructor(private readonly database: DatabasePool) {}

  async findMembershipForUpdate(tenantId: string, userId: string): Promise<MembershipRecord | null> {
    return this.getMembership(tenantId, userId, ' FOR UPDATE')
  }
  async findMembership(tenantId: string, userId: string): Promise<MembershipRecord | null> {
    return this.getMembership(tenantId, userId, '')
  }
  private async getMembership(tenantId: string, userId: string, lock: string): Promise<MembershipRecord | null> {
    const result = await this.database.query<{ tenant_id: string; user_id: string; role: MembershipRecord['role'] }>(
      `SELECT tenant_id, user_id, role FROM memberships WHERE tenant_id = $1 AND user_id = $2${lock}`, [ tenantId, userId ],
    )
    const row = result.rows[0]
    return row ? { tenantId: row.tenant_id, userId: row.user_id, role: row.role } : null
  }
  async findUserIdByEmail(email: string): Promise<string | null> {
    const result = await this.database.query<{ id: string }>('SELECT id FROM users WHERE email_normalized = $1', [ email ])
    return result.rows[0]?.id ?? null
  }
  async insertMembership(input: MembershipRecord): Promise<MembershipRecord> {
    const result = await this.database.query<{ tenant_id: string; user_id: string; role: MembershipRecord['role'] }>(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)
       RETURNING tenant_id, user_id, role`, [ input.tenantId, input.userId, input.role ],
    )
    const row = result.rows[0]
    if (!row) throw new Error('membership did not persist')
    return { tenantId: row.tenant_id, userId: row.user_id, role: row.role }
  }
  async createMemberAccount(input: MemberAccountCreationInput): Promise<MemberAccountCreationResult> {
    return this.database.transaction(async transaction => {
      // Serialize by normalized email so concurrent requests cannot create two
      // global accounts or mistakenly see an in-flight account as absent.
      await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [ input.email ])
      const existing = await transaction.query<{ id: string; email_normalized: string; display_name: string }>(
        'SELECT id, email_normalized, display_name FROM users WHERE email_normalized = $1 FOR UPDATE', [ input.email ],
      )
      const userId = existing.rows[0]?.id ?? randomUUID()
      const existingUser = Boolean(existing.rows[0])
      const email = existing.rows[0]?.email_normalized ?? input.email
      const displayName = existing.rows[0]?.display_name ?? input.displayName
      if (!existingUser) {
        await transaction.query(
          'INSERT INTO users (id, email_normalized, display_name, password_hash) VALUES ($1, $2, $3, $4)',
          [ userId, input.email, input.displayName, input.passwordHash ],
        )
      }
      const inserted = await transaction.query<{ tenant_id: string; user_id: string; role: MembershipRecord['role'] }>(
        `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, user_id) DO NOTHING
         RETURNING tenant_id, user_id, role`, [ input.tenantId, userId, input.role ],
      )
      const membership = inserted.rows[0]
      if (!membership) return { member: null, existingUser }
      await transaction.query(
        `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, target_type, target_id, request_id, metadata)
         VALUES ($1, $2, $3, $4, 'user', $5, $6, '{}'::jsonb)`,
        [ randomUUID(), input.tenantId, input.actorUserId, existingUser ? 'member_added_existing' : 'member_account_created', userId, input.requestId ?? null ],
      )
      return { member: { userId, email, displayName, role: membership.role }, existingUser }
    })
  }
  async updateMembershipRole(input: MembershipRecord): Promise<MembershipRecord | null> {
    const result = await this.database.query<{ tenant_id: string; user_id: string; role: MembershipRecord['role'] }>(
      `UPDATE memberships SET role = $3, updated_at = now() WHERE tenant_id = $1 AND user_id = $2
       RETURNING tenant_id, user_id, role`, [ input.tenantId, input.userId, input.role ],
    )
    const row = result.rows[0]
    return row ? { tenantId: row.tenant_id, userId: row.user_id, role: row.role } : null
  }
  async deleteMembership(tenantId: string, userId: string): Promise<boolean> {
    const result = await this.database.query('DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2', [ tenantId, userId ])
    return result.rowCount === 1
  }
  async listMembers(tenantId: string): Promise<MemberAccessRecord[]> {
    const result = await this.database.query<{ user_id: string; email: string; display_name: string; role: MembershipRecord['role']; project_ids: string[] }>(
      `SELECT users.id AS user_id, users.email_normalized AS email, users.display_name, memberships.role,
              COALESCE(array_agg(project_memberships.project_id ORDER BY project_memberships.project_id)
                FILTER (WHERE project_memberships.project_id IS NOT NULL), ARRAY[]::uuid[]) AS project_ids
       FROM memberships JOIN users ON users.id = memberships.user_id
       LEFT JOIN project_memberships ON project_memberships.tenant_id = memberships.tenant_id AND project_memberships.user_id = memberships.user_id
       WHERE memberships.tenant_id = $1
       GROUP BY users.id, users.email_normalized, users.display_name, memberships.role
       ORDER BY CASE memberships.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, users.email_normalized`, [ tenantId ],
    )
    return result.rows.map(row => ({ userId: row.user_id, email: row.email, displayName: row.display_name, role: row.role, projectIds: row.project_ids }))
  }
  async hasProjectAccess(tenantId: string, userId: string, projectId: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1 FROM projects JOIN memberships ON memberships.tenant_id = projects.tenant_id AND memberships.user_id = $2
       LEFT JOIN project_memberships ON project_memberships.tenant_id = projects.tenant_id AND project_memberships.project_id = projects.id AND project_memberships.user_id = $2
       WHERE projects.tenant_id = $1 AND projects.id = $3 AND (memberships.role = 'owner' OR project_memberships.user_id IS NOT NULL)`,
      [ tenantId, userId, projectId ],
    )
    return Boolean(result.rows[0])
  }
  async replaceProjectAccess(input: { tenantId: string; actorUserId: string; targetUserId: string; projectIds: string[]; requestId?: string }): Promise<boolean> {
    return this.database.transaction(async transaction => {
      const target = await transaction.query<{ role: MembershipRecord['role'] }>('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE', [ input.tenantId, input.targetUserId ])
      if (!target.rows[0] || target.rows[0].role === 'owner') return false
      const projects = await transaction.query<{ id: string }>('SELECT id FROM projects WHERE tenant_id=$1 AND id = ANY($2::uuid[]) FOR UPDATE', [ input.tenantId, input.projectIds ])
      if (projects.rows.length !== input.projectIds.length) return false
      await transaction.query('DELETE FROM project_memberships WHERE tenant_id=$1 AND user_id=$2', [ input.tenantId, input.targetUserId ])
      if (input.projectIds.length) {
        await transaction.query(
          `INSERT INTO project_memberships (tenant_id, project_id, user_id, created_by)
           SELECT $1, project_id, $2, $3 FROM unnest($4::uuid[]) AS project_id`,
          [ input.tenantId, input.targetUserId, input.actorUserId, input.projectIds ],
        )
      }
      await transaction.query(
        `INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,request_id,metadata)
         VALUES ($1,$2,$3,'member_project_access_updated','user',$4,$5,jsonb_build_object('project_ids',$6::jsonb))`,
        [ randomUUID(), input.tenantId, input.actorUserId, input.targetUserId, input.requestId ?? null, JSON.stringify(input.projectIds) ],
      )
      return true
    })
  }
  async activeRetentionDaysMax(tenantId: string): Promise<number | null> {
    const result = await this.database.query<{ retention_days_max: number }>(
      `SELECT plans.retention_days_max
       FROM subscriptions JOIN plans ON plans.id = subscriptions.plan_id
       WHERE subscriptions.tenant_id = $1 AND subscriptions.status = 'active'
         AND subscriptions.cycle_started_at <= now() AND subscriptions.cycle_ends_at > now()
       ORDER BY subscriptions.cycle_ends_at DESC LIMIT 1`, [ tenantId ],
    )
    const value = result.rows[0]?.retention_days_max
    return value === undefined ? null : Number(value)
  }
  async readDefaults(tenantId: string): Promise<TenantDefaults | null> {
    const result = await this.database.query<{ id: string; retention_days: number; data_lifecycle_policy: DataLifecyclePolicy; event_quota: number }>(
      'SELECT id,retention_days,data_lifecycle_policy,event_quota FROM tenants WHERE id=$1', [ tenantId ],
    )
    const row = result.rows[0]
    return row ? { id: row.id, retentionDays: Number(row.retention_days), dataLifecyclePolicy: row.data_lifecycle_policy, eventQuota: Number(row.event_quota) } : null
  }
  async updateDefaults(input: { tenantId: string; actorUserId: string; retentionDays?: number; dataLifecyclePolicy?: DataLifecyclePolicy; eventQuota?: number; requestId?: string }): Promise<TenantDefaults | null> {
    const result = await this.database.query<{ id: string; retention_days: number; data_lifecycle_policy: DataLifecyclePolicy; event_quota: number }>(
      `WITH updated AS (
         UPDATE tenants SET retention_days=COALESCE($2,retention_days), data_lifecycle_policy=COALESCE($3::jsonb,data_lifecycle_policy), event_quota=COALESCE($4,event_quota), updated_at=now()
         WHERE id=$1 RETURNING id,retention_days,data_lifecycle_policy,event_quota
       ), audit AS (
         INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,request_id,metadata)
         SELECT $5,$1,$6,'tenant_defaults_updated','tenant',id,$7,jsonb_strip_nulls(jsonb_build_object('retention_days',$2,'data_lifecycle_policy',CASE WHEN $3::jsonb IS NULL THEN NULL ELSE 'updated' END,'event_quota',$4)) FROM updated
       ) SELECT id,retention_days,data_lifecycle_policy,event_quota FROM updated`,
      [ input.tenantId, input.retentionDays ?? null, input.dataLifecyclePolicy ? JSON.stringify(input.dataLifecyclePolicy) : null, input.eventQuota ?? null, randomUUID(), input.actorUserId, input.requestId ?? null ],
    )
    const row = result.rows[0]
    return row ? { id: row.id, retentionDays: Number(row.retention_days), dataLifecyclePolicy: row.data_lifecycle_policy, eventQuota: Number(row.event_quota) } : null
  }
}
