import { DatabaseClient } from '../database/types'
import { AuthRepository, AuthSession, AuthTenant, AuthUser } from './types'

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const result = await this.database.query<{ id: string; email_normalized: string; display_name: string; password_hash: string }>(
      'SELECT id, email_normalized, display_name, password_hash FROM users WHERE email_normalized = $1', [ email ],
    )
    const row = result.rows[0]
    return row ? { id: row.id, email: row.email_normalized, displayName: row.display_name, passwordHash: row.password_hash } : null
  }

  async createRegistration(input: { userId: string; email: string; displayName: string; passwordHash: string; tenantId: string; tenantName: string }): Promise<AuthUser> {
    const result = await this.database.query<{ id: string; email_normalized: string; display_name: string; password_hash: string }>(
      `WITH new_user AS (
         INSERT INTO users (id, email_normalized, display_name, password_hash) VALUES ($1, $2, $3, $4)
         RETURNING id, email_normalized, display_name, password_hash
       ), new_tenant AS (
         INSERT INTO tenants (id, name) VALUES ($5, $6)
       ), new_membership AS (
         INSERT INTO memberships (tenant_id, user_id, role) SELECT $5, id, 'owner' FROM new_user
       ) SELECT id, email_normalized, display_name, password_hash FROM new_user`,
      [ input.userId, input.email, input.displayName, input.passwordHash, input.tenantId, input.tenantName ],
    )
    const row = result.rows[0]
    if (!row) throw new Error('registration did not return a user')
    return { id: row.id, email: row.email_normalized, displayName: row.display_name, passwordHash: row.password_hash }
  }

  async createSession(input: { id: string; userId: string; tokenHash: Buffer; expiresAt: Date }): Promise<AuthSession> {
    const result = await this.database.query<AuthSession>(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)
       RETURNING id, user_id AS "userId", expires_at AS "expiresAt", revoked_at AS "revokedAt"`,
      [ input.id, input.userId, input.tokenHash, input.expiresAt ],
    )
    const session = result.rows[0]
    if (!session) throw new Error('session did not persist')
    return session
  }

  async findActiveSession(tokenHash: Buffer, now: Date): Promise<AuthSession | null> {
    const result = await this.database.query<AuthSession>(
      `SELECT id, user_id AS "userId", expires_at AS "expiresAt", revoked_at AS "revokedAt"
       FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`, [ tokenHash, now ],
    )
    return result.rows[0] ?? null
  }

  async revokeSession(id: string, now: Date): Promise<boolean> {
    const result = await this.database.query('UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [ id, now ])
    return result.rowCount === 1
  }

  async listTenantsForUser(userId: string): Promise<AuthTenant[]> {
    const result = await this.database.query<{ id: string; name: string; role: AuthTenant['role'] }>(
      `SELECT t.id, t.name, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = $1 ORDER BY t.created_at ASC, t.id ASC`, [ userId ],
    )
    return result.rows
  }
}
