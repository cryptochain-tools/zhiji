import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { httpError } from '../../lib/http'
import { verifyPassword } from '../auth/password'
import { DatabaseClient } from '../database/types'
import { LifecycleProofIssuer, LifecycleRequestVerifier } from './types'

const PROOF_TTL_MS = 10 * 60 * 1000
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS_PER_WINDOW = 5

export class PostgreSqlLifecycleProof implements LifecycleRequestVerifier, LifecycleProofIssuer {
  constructor(
    private readonly database: DatabaseClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(input: Parameters<LifecycleProofIssuer['issue']>[0]) {
    if (typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 1024) throw verificationFailed()
    const issuedAt = this.now()
    const attempt = await this.database.query<{ attempts: number }>(
      `INSERT INTO lifecycle_proof_rate_limits (actor_user_id, window_started_at, attempts, updated_at)
       VALUES ($1,$2,1,$2)
       ON CONFLICT (actor_user_id) DO UPDATE SET
         window_started_at = CASE WHEN lifecycle_proof_rate_limits.window_started_at <= $3 THEN $2 ELSE lifecycle_proof_rate_limits.window_started_at END,
         attempts = CASE WHEN lifecycle_proof_rate_limits.window_started_at <= $3 THEN 1 ELSE lifecycle_proof_rate_limits.attempts + 1 END,
         updated_at = $2
       RETURNING attempts`,
      [ input.actorUserId, issuedAt, new Date(issuedAt.getTime() - ATTEMPT_WINDOW_MS) ],
    )
    if ((attempt.rows[0]?.attempts ?? MAX_ATTEMPTS_PER_WINDOW + 1) > MAX_ATTEMPTS_PER_WINDOW) {
      throw httpError(429, 'lifecycle_reauthentication_rate_limited', 'Lifecycle verification is temporarily unavailable')
    }
    const user = await this.database.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [ input.actorUserId ])
    const passwordHash = user.rows[0]?.password_hash
    if (!passwordHash || !await verifyPassword(input.password, passwordHash)) throw verificationFailed()
    await this.database.query('DELETE FROM lifecycle_proof_rate_limits WHERE actor_user_id = $1', [ input.actorUserId ])

    const expiresAt = new Date(issuedAt.getTime() + PROOF_TTL_MS)
    const proof = randomBytes(32).toString('base64url')
    await this.database.query(
      `DELETE FROM lifecycle_proofs
       WHERE expires_at <= $1 OR (tenant_id = $2 AND project_id = $3 AND actor_user_id = $4 AND operation = $5)`,
      [ issuedAt, input.tenantId, input.projectId, input.actorUserId, input.operation ],
    )
    await this.database.query(
      `INSERT INTO lifecycle_proofs
         (id, tenant_id, project_id, actor_user_id, operation, subject_business_user_id,
          purpose_hash, token_hash, reauthenticated_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [ randomUUID(), input.tenantId, input.projectId, input.actorUserId, input.operation,
        input.subjectBusinessUserId ?? null, digest(input.purpose), digest(proof), issuedAt, expiresAt ],
    )
    return { proof, expiresAt }
  }

  async verify(input: Parameters<LifecycleRequestVerifier['verify']>[0]) {
    if (typeof input.proof !== 'string' || input.proof.length < 32 || input.proof.length > 200) return null
    const consumed = await this.database.query<{ verification_method: string; reauthenticated_at: Date }>(
      `DELETE FROM lifecycle_proofs
       WHERE token_hash = $1 AND tenant_id = $2 AND project_id = $3 AND actor_user_id = $4
         AND operation = $5 AND subject_business_user_id IS NOT DISTINCT FROM $6
         AND purpose_hash = $7 AND expires_at > $8
       RETURNING verification_method, reauthenticated_at`,
      [ digest(input.proof), input.tenantId, input.projectId, input.actorUserId, input.operation,
        input.subjectBusinessUserId ?? null, digest(input.purpose), this.now() ],
    )
    const row = consumed.rows[0]
    return row ? { method: row.verification_method, reauthenticatedAt: row.reauthenticated_at } : null
  }
}

function digest(value: string): Buffer { return createHash('sha256').update(value, 'utf8').digest() }
function verificationFailed(): Error { return httpError(401, 'lifecycle_reauthentication_failed', 'Current password verification failed') }
