import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { AuthFacade, tokenHash } from '../../../../app/service/auth'
import { hashPassword, verifyPassword } from '../../../../app/service/auth/password'
import { AuthRepository, AuthSession, AuthTenant, AuthUser } from '../../../../app/service/auth/types'

class MemoryAuthRepository implements AuthRepository {
  users = new Map<string, AuthUser>()
  sessions = new Map<string, { session: AuthSession; tokenHash: Buffer }>()
  async findUserByEmail(email: string) { return this.users.get(email) ?? null }
  async createRegistration(input: { userId: string; email: string; displayName: string; passwordHash: string; tenantId: string; tenantName: string }) {
    const user = { id: input.userId, email: input.email, displayName: input.displayName, passwordHash: input.passwordHash }
    this.users.set(user.email, user); return user
  }
  async createSession(input: { id: string; userId: string; tokenHash: Buffer; expiresAt: Date }) {
    const session = { id: input.id, userId: input.userId, expiresAt: input.expiresAt, revokedAt: null }
    this.sessions.set(input.id, { session, tokenHash: input.tokenHash }); return session
  }
  async findActiveSession(hash: Buffer, now: Date) { for (const entry of this.sessions.values()) if (entry.tokenHash.equals(hash) && !entry.session.revokedAt && entry.session.expiresAt > now) return entry.session; return null }
  async revokeSession(id: string, _now: Date) { const entry = this.sessions.get(id); if (!entry || entry.session.revokedAt) return false; entry.session.revokedAt = new Date(); return true }
  async listTenantsForUser(_userId: string): Promise<AuthTenant[]> { return [] }
}

describe('auth service', () => {
  it('uses salted memory-hard password hashes', async () => {
    const encoded = await hashPassword('correct horse battery staple')
    assert.match(encoded, /^scrypt\$/)
    assert.equal(await verifyPassword('correct horse battery staple', encoded), true)
    assert.equal(await verifyPassword('wrong password', encoded), false)
  })

  it('stores only a session digest and revokes the current session', async () => {
    const repository = new MemoryAuthRepository()
    const facade = new AuthFacade({ repository, registrationEnabled: true, now: () => new Date('2026-01-01T00:00:00Z'), createId: (() => { let i = 0; return () => `00000000-0000-4000-8000-${String(++i).padStart(12, '0')}` })(), createToken: () => 'a'.repeat(43) })
    const registration = await facade.register({ email: 'OWNER@Example.com', password: 'correct horse battery staple', displayName: 'Owner', tenantName: 'Tenant' })
    assert.equal(repository.sessions.size, 1)
    assert.notEqual([...repository.sessions.values()][0]!.tokenHash.toString('hex'), registration.token)
    assert.equal((await facade.authenticate(registration.token))?.userId, '00000000-0000-4000-8000-000000000001')
    await facade.logout(await facade.authenticate(registration.token))
    assert.equal(await facade.authenticate(registration.token), null)
    assert.equal(tokenHash(registration.token).length, 32)
  })

  it('fails closed when registration is disabled', async () => {
    const facade = new AuthFacade({ repository: new MemoryAuthRepository(), registrationEnabled: false })
    await assert.rejects(() => facade.register({ email: 'a@b.co', password: 'correct horse battery staple', displayName: 'a', tenantName: 'b' }), { code: 'registration_disabled' })
  })
})
