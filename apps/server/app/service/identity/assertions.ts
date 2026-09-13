import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { DatabaseClient } from '../database/types'

export interface IdentityAssertionScope {
  tenantId: string
  projectId: string
  visitorId: string
  businessUserId: string
}

export interface MintIdentityAssertionInput extends IdentityAssertionScope {
  issuedByUserId?: string
  ttlSeconds?: number
}

/**
 * Issues an opaque credential. Only its SHA-256 digest is stored; callers must
 * deliver the plaintext directly to their browser and never log or persist it.
 */
export async function mintIdentityAssertion(database: DatabaseClient, input: MintIdentityAssertionInput, now = new Date()): Promise<{ assertion: string; expiresAt: Date }> {
  const ttlSeconds = input.ttlSeconds ?? 300
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 900) throw new Error('identity assertion ttl must be between 30 and 900 seconds')
  validateScope(input)
  const assertion = `zj_ia_${randomBytes(32).toString('base64url')}`
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
  await database.query(
    `INSERT INTO identity_assertions
     (id, token_hash, tenant_id, project_id, visitor_id, business_user_id, expires_at, issued_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [ randomUUID(), tokenHash(assertion), input.tenantId, input.projectId, input.visitorId, input.businessUserId, expiresAt, input.issuedByUserId ?? null ],
  )
  return { assertion, expiresAt }
}

/** Atomically consumes a credential in the caller's fact transaction. */
export async function consumeIdentityAssertion(database: DatabaseClient, input: IdentityAssertionScope & { assertion: string }, now = new Date()): Promise<boolean> {
  validateScope(input)
  if (typeof input.assertion !== 'string' || input.assertion.length < 32 || input.assertion.length > 1024) return false
  const result = await database.query(
    `UPDATE identity_assertions SET consumed_at = $7
     WHERE token_hash = $1 AND tenant_id = $2 AND project_id = $3 AND visitor_id = $4 AND business_user_id = $5
       AND consumed_at IS NULL AND expires_at > $6`,
    [ tokenHash(input.assertion), input.tenantId, input.projectId, input.visitorId, input.businessUserId, now, now ],
  )
  return result.rowCount === 1
}

function tokenHash(value: string): Buffer { return createHash('sha256').update(value, 'utf8').digest() }
function validateScope(input: IdentityAssertionScope): void {
  for (const value of [ input.tenantId, input.projectId, input.visitorId, input.businessUserId ]) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 128 || value.trim() !== value) throw new Error('identity assertion scope is invalid')
  }
}
