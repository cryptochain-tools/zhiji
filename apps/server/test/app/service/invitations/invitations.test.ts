import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { InvitationManagementService, tokenHash } from '../../../../app/service/invitations'
import { InvitationCreateInput, InvitationRecord, InvitationRepository } from '../../../../app/service/invitations/types'

const tenantId = '30000000-0000-4000-8000-000000000001'
const ownerId = '30000000-0000-4000-8000-000000000002'
const invitationId = '30000000-0000-4000-8000-000000000003'
const now = new Date('2026-09-12T12:00:00.000Z')
const invitation: InvitationRecord = { id: invitationId, tenantId, email: 'new@example.com', role: 'admin', invitedByUserId: ownerId, expiresAt: new Date(now.getTime() + 7 * 86_400_000), acceptedAt: null, revokedAt: null, createdAt: now }

class Invitations implements InvitationRepository {
  created: InvitationCreateInput | null = null
  accepted: { tokenHash: Buffer; passwordHash?: string; displayName?: string } | null = null
  async create(input: InvitationCreateInput) { this.created = input; return { invitation, inserted: true } }
  async resend(input: Parameters<InvitationRepository['resend']>[0]) { input.authorizeRole(invitation.role); return { invitation, inserted: true } }
  async accept(input: { tokenHash: Buffer; passwordHash?: string; displayName?: string }) { this.accepted = input; return { invitation: { ...invitation, acceptedAt: now }, userId: ownerId } }
}

function service(repository = new Invitations()) {
  return { repository, service: new InvitationManagementService({ repository, now: () => now, createToken: () => 'x'.repeat(43), encryptDelivery: value => ({ sealed: Buffer.from(JSON.stringify(value)).toString('base64url') }) }) }
}

describe('InvitationManagementService', () => {
  it('hashes the one-time token, seals the outbox delivery payload, and never returns either', async () => {
    const { repository, service: domain } = service()
    const result = await domain.create({ tenantId, userId: ownerId, role: 'owner' }, 'invite-1', { email: ' New@Example.com ', role: 'admin' }, 'request-1')
    assert.equal(result.invitation.id, invitationId)
    assert.equal(JSON.stringify(result).includes('x'.repeat(43)), false)
    assert.deepEqual(repository.created?.tokenHash, tokenHash('x'.repeat(43)))
    assert.equal(JSON.stringify(repository.created?.delivery).includes('new@example.com'), false)
    assert.equal(repository.created?.requestId, 'request-1')
  })

  it('does not allow an admin to resend an owner-created admin invitation', async () => {
    const { service: domain } = service()
    await assert.rejects(() => domain.resend({ tenantId, userId: ownerId, role: 'admin' }, invitationId, 'resend-1'), { code: 'tenant_action_denied' })
  })

  it('uses one generic failure for missing, expired, or malformed acceptance tokens', async () => {
    const { service: domain } = service()
    await assert.rejects(() => domain.accept({ token: '' }), { code: 'invitation_accept_failed' })
    await assert.rejects(() => domain.accept({ token: 'short' }), { code: 'invitation_accept_failed' })
  })

  it('hashes an acceptance token before it reaches the repository', async () => {
    const { repository, service: domain } = service()
    await domain.accept({ token: 't'.repeat(32), display_name: 'New user', password: 'a long enough password' })
    assert.deepEqual(repository.accepted?.tokenHash, tokenHash('t'.repeat(32)))
    assert.ok(repository.accepted?.passwordHash)
    assert.equal(repository.accepted?.displayName, 'New user')
  })
})
