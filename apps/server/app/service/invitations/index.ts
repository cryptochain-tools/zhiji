import { createHash, randomBytes } from 'node:crypto'
import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { hashPassword, PasswordValidationError } from '../auth/password'
import { normalizeEmail } from '../auth'
import { canAssignRole } from '../tenancy/policy'
import { isUuid, parseRole } from '../tenancy'
import { InvitationDependencies, InvitationRecord } from './types'

const TTL_MS = 7 * 24 * 60 * 60 * 1000

export class InvitationManagementService {
  constructor(private readonly dependencies: InvitationDependencies) {}

  async create(scope: { tenantId: string; userId: string; role: import('../database/types').MembershipRole }, idempotencyKey: unknown, raw: unknown, requestId?: string) {
    const input = inviteInput(raw)
    this.authorize(scope, input.role)
    const key = idempotency(idempotencyKey)
    const token = this.token()
    const delivery = this.delivery(input.email, token)
    const result = await this.dependencies.repository.create({ scope, email: input.email, role: input.role, idempotencyKey: key, tokenHash: tokenHash(token), delivery, expiresAt: this.expiry(), requestId })
    return { invitation: dto(result.invitation), idempotent: !result.inserted }
  }

  async resend(scope: { tenantId: string; userId: string; role: import('../database/types').MembershipRole }, invitationId: unknown, idempotencyKey: unknown, requestId?: string) {
    this.authorize(scope, 'viewer')
    if (!isUuid(invitationId)) throw httpError(404, 'invitation_not_found', 'Invitation was not found')
    const key = idempotency(idempotencyKey)
    const token = this.token()
    // The repository reloads email/role under lock and revokes the old token.
    const result = await this.dependencies.repository.resend({ tenantId: scope.tenantId, invitationId, scope, idempotencyKey: key, tokenHash: tokenHash(token), deliveryForEmail: email => this.delivery(email, token), authorizeRole: role => this.authorize(scope, role), expiresAt: this.expiry(), requestId })
    if (!result) throw httpError(409, 'invitation_not_available', 'Invitation is no longer available')
    return { invitation: dto(result.invitation), idempotent: !result.inserted }
  }

  async accept(raw: unknown, requestId?: string) {
    const value = object(raw, 'invitation_accept_failed')
    if (!safeText(value.token, 1024) || value.token.trim().length < 32) throw acceptFailed()
    let passwordHash: string | undefined
    let displayName: string | undefined
    if (value.password !== undefined || value.display_name !== undefined) {
      if (!safeText(value.display_name, 200) || typeof value.password !== 'string') throw acceptFailed()
      try { passwordHash = await hashPassword(value.password); displayName = value.display_name.trim() }
      catch (error) { if (error instanceof PasswordValidationError) throw acceptFailed(); throw error }
    }
    const accepted = await this.dependencies.repository.accept({ tokenHash: tokenHash(value.token.trim()), passwordHash, displayName, requestId })
    if (!accepted) throw acceptFailed()
    return { accepted: true, invitation: dto(accepted.invitation) }
  }

  private authorize(scope: { role: import('../database/types').MembershipRole }, invitedRole: Exclude<import('../database/types').MembershipRole, 'owner'>) {
    if ((scope.role !== 'owner' && scope.role !== 'admin') || !canAssignRole(scope.role, invitedRole)) throw httpError(403, 'tenant_action_denied', 'Tenant action is denied')
  }
  private token(): string { const token = (this.dependencies.createToken ?? (() => randomBytes(32).toString('base64url')))(); if (token.length < 32) throw new Error('invitation token generator returned a weak token'); return token }
  private delivery(email: string, token: string): Record<string, unknown> { const delivery = this.dependencies.encryptDelivery?.({ email, token }) ?? null; if (!delivery) throw httpError(503, 'invitation_delivery_unavailable', 'Invitation delivery is unavailable'); return delivery }
  private expiry(): Date { return new Date((this.dependencies.now ?? (() => new Date()))().getTime() + TTL_MS) }
}

export function invitationDependenciesFromApp(app: unknown): InvitationDependencies | null { return (app as { invitationDependencies?: InvitationDependencies }).invitationDependencies ?? null }
export function tokenHash(token: string): Buffer { return createHash('sha256').update(token).digest() }
export function dto(value: InvitationRecord) { return { id: value.id, role: value.role, expires_at: value.expiresAt.toISOString(), accepted_at: value.acceptedAt?.toISOString() ?? null, revoked_at: value.revokedAt?.toISOString() ?? null, created_at: value.createdAt.toISOString() } }

function inviteInput(raw: unknown): { email: string; role: Exclude<import('../database/types').MembershipRole, 'owner'> } {
  const value = object(raw, 'invalid_invitation')
  const email = normalizeEmail(value.email); const role = parseRole(value.role)
  if (!email || !role || role === 'owner') throw httpError(400, 'invalid_invitation', 'Invitation is invalid')
  return { email, role }
}
function idempotency(value: unknown): string { if (!safeText(value, 200)) throw httpError(400, 'invalid_idempotency_key', 'Idempotency-Key is required'); return value.trim() }
function object(value: unknown, code: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, code, code === 'invitation_accept_failed' ? 'Invitation acceptance failed' : 'Invitation is invalid'); return value as Record<string, unknown> }
function safeText(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max }
function acceptFailed() { return httpError(400, 'invitation_accept_failed', 'Invitation acceptance failed') }

export default class InvitationsService extends Service {
  private domain(): InvitationManagementService { const dependencies = invitationDependenciesFromApp(this.app); if (!dependencies) throw httpError(503, 'invitation_delivery_unavailable', 'Invitation delivery is unavailable'); return new InvitationManagementService(dependencies) }
  create(scope: { tenantId: string; userId: string; role: import('../database/types').MembershipRole }, key: unknown, raw: unknown, requestId?: string) { return this.domain().create(scope, key, raw, requestId) }
  resend(scope: { tenantId: string; userId: string; role: import('../database/types').MembershipRole }, id: unknown, key: unknown, requestId?: string) { return this.domain().resend(scope, id, key, requestId) }
  accept(raw: unknown, requestId?: string) { return this.domain().accept(raw, requestId) }
}
