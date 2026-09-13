import { randomUUID } from 'node:crypto'
import { DatabasePool, DatabaseTransaction } from '../database/types'
import { InvitationAcceptanceInput, InvitationCreateInput, InvitationRecord, InvitationRepository } from './types'

type InvitationRow = {
  id: string; tenant_id: string; email_normalized: string; role: InvitationRecord['role']; invited_by_user_id: string
  expires_at: Date; accepted_at: Date | null; revoked_at: Date | null; created_at: Date
}

function record(row: InvitationRow): InvitationRecord {
  return { id: row.id, tenantId: row.tenant_id, email: row.email_normalized, role: row.role, invitedByUserId: row.invited_by_user_id, expiresAt: row.expires_at, acceptedAt: row.accepted_at, revokedAt: row.revoked_at, createdAt: row.created_at }
}

/** All state transitions use a DB transaction, so a token can only create one membership. */
export class PostgresInvitationRepository implements InvitationRepository {
  constructor(private readonly database: DatabasePool) {}

  async create(input: InvitationCreateInput): Promise<{ invitation: InvitationRecord; inserted: boolean }> {
    return this.database.transaction(async transaction => this.createInTransaction(transaction, input))
  }

  async resend(input: { tenantId: string; invitationId: string; scope: InvitationCreateInput['scope']; idempotencyKey: string; tokenHash: Buffer; deliveryForEmail: (email: string) => Record<string, unknown>; authorizeRole: (role: InvitationRecord['role']) => void; expiresAt: Date; requestId?: string }): Promise<{ invitation: InvitationRecord; inserted: boolean } | null> {
    return this.database.transaction(async transaction => {
      const source = await transaction.query<InvitationRow>(
        `SELECT id, tenant_id, email_normalized, role, invited_by_user_id, expires_at, accepted_at, revoked_at, created_at
         FROM invitations WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [ input.invitationId, input.tenantId ],
      )
      const invitation = source.rows[0]
      if (!invitation || invitation.accepted_at || invitation.revoked_at) return null
      input.authorizeRole(invitation.role)
      return this.createInTransaction(transaction, {
        scope: input.scope, email: invitation.email_normalized, role: invitation.role, idempotencyKey: input.idempotencyKey,
        tokenHash: input.tokenHash, delivery: input.deliveryForEmail(invitation.email_normalized), expiresAt: input.expiresAt, requestId: input.requestId,
      })
    })
  }

  async accept(input: InvitationAcceptanceInput): Promise<{ invitation: InvitationRecord; userId: string } | null> {
    return this.database.transaction(async transaction => {
      const found = await transaction.query<InvitationRow>(
        `SELECT id, tenant_id, email_normalized, role, invited_by_user_id, expires_at, accepted_at, revoked_at, created_at
         FROM invitations
         WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
         FOR UPDATE`, [ input.tokenHash ],
      )
      const invitation = found.rows[0]
      if (!invitation) return null
      const user = await transaction.query<{ id: string }>('SELECT id FROM users WHERE email_normalized = $1 FOR UPDATE', [ invitation.email_normalized ])
      let userId = user.rows[0]?.id
      if (!userId) {
        if (!input.passwordHash || !input.displayName) return null
        userId = randomUUID()
        await transaction.query(
          'INSERT INTO users (id, email_normalized, display_name, password_hash) VALUES ($1,$2,$3,$4)',
          [ userId, invitation.email_normalized, input.displayName, input.passwordHash ],
        )
      }
      const accepted = await transaction.query<InvitationRow>(
        `UPDATE invitations SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
         RETURNING id, tenant_id, email_normalized, role, invited_by_user_id, expires_at, accepted_at, revoked_at, created_at`, [ invitation.id ],
      )
      const acceptedInvitation = accepted.rows[0]
      if (!acceptedInvitation) return null
      await transaction.query(
        `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = CASE WHEN memberships.role = 'owner' THEN 'owner' ELSE EXCLUDED.role END, updated_at = now()`,
        [ invitation.tenant_id, userId, invitation.role ],
      )
      await this.audit(transaction, invitation.tenant_id, userId, 'invitation_accepted', invitation.id, { role: invitation.role }, input.requestId)
      return { invitation: record(acceptedInvitation), userId }
    })
  }

  private async createInTransaction(transaction: DatabaseTransaction, input: InvitationCreateInput): Promise<{ invitation: InvitationRecord; inserted: boolean }> {
    const sameRequest = await transaction.query<InvitationRow>(
      `SELECT id, tenant_id, email_normalized, role, invited_by_user_id, expires_at, accepted_at, revoked_at, created_at
       FROM invitations WHERE tenant_id = $1 AND invited_by_user_id = $2 AND idempotency_key = $3`,
      [ input.scope.tenantId, input.scope.userId, input.idempotencyKey ],
    )
    if (sameRequest.rows[0]) return { invitation: record(sameRequest.rows[0]), inserted: false }
    // Serialize this email scope, including expired invitation replacement.
    await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [ `${input.scope.tenantId}\u0000${input.email}` ])
    const existing = await transaction.query<InvitationRow & { idempotency_key: string }>(
      `SELECT id, tenant_id, email_normalized, role, invited_by_user_id, expires_at, accepted_at, revoked_at, created_at, idempotency_key
       FROM invitations WHERE tenant_id = $1 AND email_normalized = $2 AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE`,
      [ input.scope.tenantId, input.email ],
    )
    const prior = existing.rows[0]
    if (prior?.idempotency_key === input.idempotencyKey && prior.invited_by_user_id === input.scope.userId) return { invitation: record(prior), inserted: false }
    if (prior) await transaction.query('UPDATE invitations SET revoked_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL', [ prior.id ])
    const id = randomUUID()
    const created = await transaction.query<InvitationRow>(
      `INSERT INTO invitations (id, tenant_id, email_normalized, role, invited_by_user_id, token_hash, expires_at, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, tenant_id, email_normalized, role, invited_by_user_id, expires_at, accepted_at, revoked_at, created_at`,
      [ id, input.scope.tenantId, input.email, input.role, input.scope.userId, input.tokenHash, input.expiresAt, input.idempotencyKey ],
    )
    const invitation = created.rows[0]
    if (!invitation) throw new Error('invitation did not persist')
    await transaction.query(
      `INSERT INTO outbox_messages (id, tenant_id, project_id, topic, idempotency_key, payload, max_attempts)
       VALUES ($1,$2,NULL,'invitation_email',$3,$4::jsonb,5)`,
      [ randomUUID(), input.scope.tenantId, `invitation-email:${id}`, JSON.stringify({ invitation_id: id, delivery: input.delivery }) ],
    )
    await this.audit(transaction, input.scope.tenantId, input.scope.userId, prior ? 'invitation_resent' : 'invitation_created', id, { role: input.role }, input.requestId)
    return { invitation: record(invitation), inserted: true }
  }

  private async audit(transaction: DatabaseTransaction, tenantId: string, actorUserId: string, action: string, invitationId: string, metadata: Record<string, unknown>, requestId?: string) {
    await transaction.query(
      `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, target_type, target_id, request_id, metadata)
       VALUES ($1,$2,$3,$4,'invitation',$5,$6,$7::jsonb)`,
      [ randomUUID(), tenantId, actorUserId, action, invitationId, requestId ?? null, JSON.stringify(metadata) ],
    )
  }
}
