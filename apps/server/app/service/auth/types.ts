import { MembershipRole } from '../database/types'

export interface AuthUser {
  id: string
  email: string
  displayName: string
  passwordHash: string
}

export interface AuthTenant {
  id: string
  name: string
  role: MembershipRole
}

export interface AuthSession {
  id: string
  userId: string
  expiresAt: Date
  revokedAt: Date | null
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUser | null>
  createRegistration(input: { userId: string; email: string; displayName: string; passwordHash: string; tenantId: string; tenantName: string }): Promise<AuthUser>
  createSession(input: { id: string; userId: string; tokenHash: Buffer; expiresAt: Date }): Promise<AuthSession>
  findActiveSession(tokenHash: Buffer, now: Date): Promise<AuthSession | null>
  revokeSession(id: string, now: Date): Promise<boolean>
  listTenantsForUser(userId: string): Promise<AuthTenant[]>
}

export interface AuthDependencies {
  repository: AuthRepository
  now?: () => Date
  createId?: () => string
  createToken?: () => string
  sessionTtlSeconds?: number
  registrationEnabled?: boolean
}

export interface AuthenticatedPrincipal {
  sessionId: string
  userId: string
  expiresAt: Date
}
