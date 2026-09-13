import { MembershipRole } from '../database/types'
import { TenantContext } from '../tenancy/types'

export interface InvitationRecord {
  id: string
  tenantId: string
  email: string
  role: Exclude<MembershipRole, 'owner'>
  invitedByUserId: string
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

export interface InvitationCreateInput {
  scope: TenantContext
  email: string
  role: Exclude<MembershipRole, 'owner'>
  idempotencyKey: string
  tokenHash: Buffer
  delivery: Record<string, unknown>
  expiresAt: Date
  requestId?: string
}

export interface InvitationAcceptanceInput {
  tokenHash: Buffer
  passwordHash?: string
  displayName?: string
  requestId?: string
}

export interface InvitationRepository {
  create(input: InvitationCreateInput): Promise<{ invitation: InvitationRecord; inserted: boolean }>
  resend(input: { tenantId: string; invitationId: string; scope: TenantContext; idempotencyKey: string; tokenHash: Buffer; deliveryForEmail: (email: string) => Record<string, unknown>; authorizeRole: (role: Exclude<MembershipRole, 'owner'>) => void; expiresAt: Date; requestId?: string }): Promise<{ invitation: InvitationRecord; inserted: boolean } | null>
  accept(input: InvitationAcceptanceInput): Promise<{ invitation: InvitationRecord; userId: string } | null>
}

export interface InvitationDependencies {
  repository: InvitationRepository
  now?: () => Date
  createToken?: () => string
  encryptDelivery?: (value: { email: string; token: string }) => Record<string, unknown> | null
}
