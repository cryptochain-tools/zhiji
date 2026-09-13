import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { hashPassword } from '../../../../app/service/auth/password'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'
import { PostgreSqlLifecycleProof } from '../../../../app/service/lifecycle/verification'

const now = new Date('2026-09-13T06:00:00.000Z')
const scope = {
  tenantId: '20000000-0000-4000-8000-000000000001',
  projectId: '20000000-0000-4000-8000-000000000002',
  actorUserId: '20000000-0000-4000-8000-000000000003',
  operation: 'subject_export' as const,
  subjectBusinessUserId: 'account-42',
  purpose: 'respond to access request',
}

describe('PostgreSqlLifecycleProof', () => {
  it('issues a scope-bound proof after password verification and consumes it once', async () => {
    const database = new ProofDatabase(await hashPassword('correct horse battery staple'))
    const verifier = new PostgreSqlLifecycleProof(database, () => now)
    const issued = await verifier.issue({ ...scope, password: 'correct horse battery staple' })

    assert.equal(issued.proof.length >= 32, true)
    assert.equal(issued.expiresAt.toISOString(), '2026-09-13T06:10:00.000Z')
    assert.deepEqual(await verifier.verify({ ...scope, proof: issued.proof }), { method: 'owner_reauthenticated', reauthenticatedAt: now })
    assert.equal(await verifier.verify({ ...scope, proof: issued.proof }), null)
  })

  it('does not consume a proof presented for a different purpose or subject', async () => {
    const database = new ProofDatabase(await hashPassword('correct horse battery staple'))
    const verifier = new PostgreSqlLifecycleProof(database, () => now)
    const issued = await verifier.issue({ ...scope, password: 'correct horse battery staple' })

    assert.equal(await verifier.verify({ ...scope, purpose: 'different purpose', proof: issued.proof }), null)
    assert.equal(await verifier.verify({ ...scope, subjectBusinessUserId: 'account-43', proof: issued.proof }), null)
    assert.deepEqual(await verifier.verify({ ...scope, proof: issued.proof }), { method: 'owner_reauthenticated', reauthenticatedAt: now })
  })

  it('rejects an incorrect current password without creating a proof', async () => {
    const database = new ProofDatabase(await hashPassword('correct horse battery staple'))
    const verifier = new PostgreSqlLifecycleProof(database, () => now)
    await assert.rejects(() => verifier.issue({ ...scope, password: 'incorrect password' }), (error: Error & { code?: string }) => error.code === 'lifecycle_reauthentication_failed')
    assert.equal(database.proof, null)
  })

  it('rate limits repeated password attempts before another password hash is checked', async () => {
    const database = new ProofDatabase(await hashPassword('correct horse battery staple'))
    const verifier = new PostgreSqlLifecycleProof(database, () => now)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(() => verifier.issue({ ...scope, password: 'incorrect password' }))
    }
    await assert.rejects(
      () => verifier.issue({ ...scope, password: 'correct horse battery staple' }),
      (error: Error & { code?: string }) => error.code === 'lifecycle_reauthentication_rate_limited',
    )
    assert.equal(database.passwordReads, 5)
  })
})

class ProofDatabase implements DatabaseClient {
  proof: { values: readonly unknown[] } | null = null
  attempts = 0
  passwordReads = 0
  private readonly passwordHash: string
  constructor(passwordHash: string) { this.passwordHash = passwordHash }

  async query<Row extends object = Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<QueryResult<Row>> {
    if (text.startsWith('INSERT INTO lifecycle_proof_rate_limits')) {
      this.attempts += 1
      return { rows: [{ attempts: this.attempts } as Row], rowCount: 1 }
    }
    if (text.startsWith('DELETE FROM lifecycle_proof_rate_limits')) { this.attempts = 0; return { rows: [], rowCount: 1 } }
    if (text.startsWith('SELECT password_hash')) { this.passwordReads += 1; return { rows: [{ password_hash: this.passwordHash } as Row], rowCount: 1 } }
    if (text.includes('INSERT INTO lifecycle_proofs')) { this.proof = { values }; return { rows: [], rowCount: 1 } }
    if (text.startsWith('DELETE FROM lifecycle_proofs') && !text.includes('RETURNING')) {
      const stored = this.proof?.values
      const expired = stored?.[9] instanceof Date && values[0] instanceof Date && stored[9] <= values[0]
      const replaced = stored && values[1] === stored[1] && values[2] === stored[2] && values[3] === stored[3] && values[4] === stored[4]
      if (expired || replaced) this.proof = null
      return { rows: [], rowCount: expired || replaced ? 1 : 0 }
    }
    if (text.startsWith('DELETE FROM lifecycle_proofs')) {
      const stored = this.proof?.values
      const matches = stored
        && equalBuffer(values[0], stored[7])
        && values[1] === stored[1] && values[2] === stored[2] && values[3] === stored[3]
        && values[4] === stored[4] && values[5] === stored[5]
        && equalBuffer(values[6], stored[6])
        && stored[9] instanceof Date && values[7] instanceof Date && stored[9] > values[7]
      if (!matches) return { rows: [], rowCount: 0 }
      this.proof = null
      return { rows: [{ verification_method: 'owner_reauthenticated', reauthenticated_at: stored[8] } as Row], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  }
}

function equalBuffer(left: unknown, right: unknown): boolean { return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.equals(right) }
