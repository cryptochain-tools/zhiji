import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { hashPassword, PasswordValidationError, verifyPassword } from './password'
import { AuthDependencies, AuthenticatedPrincipal } from './types'

const FALLBACK: AuthDependencies = {
  repository: {
    findUserByEmail: async () => null,
    createRegistration: async () => { throw unavailable() },
    createSession: async () => { throw unavailable() },
    findActiveSession: async () => null,
    revokeSession: async () => false,
    listTenantsForUser: async () => [],
  },
  registrationEnabled: false,
}

export function authDependenciesFromApp(app: unknown): AuthDependencies {
  return (app as { authDependencies?: AuthDependencies }).authDependencies ?? FALLBACK
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length >= 3 && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

export function tokenHash(token: string): Buffer { return createHash('sha256').update(token).digest() }

export class AuthFacade {
  constructor(private readonly dependencies: AuthDependencies) {}

  async register(input: { email: unknown; password: unknown; displayName: unknown; tenantName: unknown }) {
    if (!this.dependencies.registrationEnabled) throw httpError(403, 'registration_disabled', 'Registration is disabled')
    const email = normalizeEmail(input.email)
    const displayName = normalizeName(input.displayName)
    const tenantName = normalizeName(input.tenantName)
    if (!email || !displayName || !tenantName) throw httpError(400, 'registration_failed', 'Registration failed')
    try {
      const passwordHash = await hashPassword(input.password as string)
      const existing = await this.dependencies.repository.findUserByEmail(email)
      if (existing) throw httpError(400, 'registration_failed', 'Registration failed')
      const user = await this.dependencies.repository.createRegistration({
        userId: (this.dependencies.createId ?? randomUUID)(), email, displayName, passwordHash,
        tenantId: (this.dependencies.createId ?? randomUUID)(), tenantName,
      })
      return this.createSession(user.id)
    } catch (error) {
      if (error instanceof PasswordValidationError) throw httpError(400, 'registration_failed', 'Registration failed')
      throw error
    }
  }

  async login(input: { email: unknown; password: unknown }) {
    const email = normalizeEmail(input.email)
    if (!email || typeof input.password !== 'string') throw httpError(401, 'invalid_credentials', 'Invalid credentials')
    const user = await this.dependencies.repository.findUserByEmail(email)
    if (!user || !await verifyPassword(input.password, user.passwordHash)) throw httpError(401, 'invalid_credentials', 'Invalid credentials')
    return this.createSession(user.id)
  }

  async issueSession(userId: string) { return this.createSession(userId) }

  async authenticate(token: unknown): Promise<AuthenticatedPrincipal | null> {
    if (typeof token !== 'string' || token.length < 32 || token.length > 1024) return null
    const session = await this.dependencies.repository.findActiveSession(tokenHash(token), this.now())
    return session ? { sessionId: session.id, userId: session.userId, expiresAt: session.expiresAt } : null
  }

  async logout(principal: AuthenticatedPrincipal | null): Promise<void> {
    if (principal) await this.dependencies.repository.revokeSession(principal.sessionId, this.now())
  }

  async me(principal: AuthenticatedPrincipal) {
    return { user_id: principal.userId, tenants: await this.dependencies.repository.listTenantsForUser(principal.userId) }
  }

  private async createSession(userId: string) {
    const now = this.now()
    const ttl = this.dependencies.sessionTtlSeconds ?? 60 * 60 * 24 * 7
    const token = (this.dependencies.createToken ?? (() => randomBytes(32).toString('base64url')))()
    if (token.length < 32) throw new Error('session token generator returned a weak token')
    const session = await this.dependencies.repository.createSession({ id: (this.dependencies.createId ?? randomUUID)(), userId, tokenHash: tokenHash(token), expiresAt: new Date(now.getTime() + ttl * 1000) })
    return { token, expires_at: session.expiresAt.toISOString() }
  }

  private now(): Date { return (this.dependencies.now ?? (() => new Date()))() }
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length >= 1 && normalized.length <= 200 ? normalized : null
}
function unavailable(): Error { return httpError(503, 'auth_unavailable', 'Authentication is unavailable') }

export default class AuthService extends Service {
  private readonly facade = new AuthFacade(authDependenciesFromApp(this.app))
  register(input: { email: unknown; password: unknown; displayName: unknown; tenantName: unknown }) { return this.facade.register(input) }
  login(input: { email: unknown; password: unknown }) { return this.facade.login(input) }
  issueSession(userId: string) { return this.facade.issueSession(userId) }
  authenticate(token: unknown) { return this.facade.authenticate(token) }
  logout(principal: AuthenticatedPrincipal | null) { return this.facade.logout(principal) }
  me(principal: AuthenticatedPrincipal) { return this.facade.me(principal) }
}
