import { MembershipRole } from '../database/types'
import type { DataLifecyclePolicy } from '@zhiji/contracts'

export interface TenantContext {
  tenantId: string
  userId: string
  role: MembershipRole
}

export interface MembershipRecord { tenantId: string; userId: string; role: MembershipRole }
export interface MemberAccountRecord { userId: string; email: string; displayName: string; role: MembershipRole }
export interface MemberAccessRecord extends MemberAccountRecord { projectIds: string[] }
export interface MemberAccountCreationInput { tenantId: string; actorUserId: string; email: string; displayName: string; passwordHash: string; role: MembershipRole; requestId?: string }
export interface MemberAccountCreationResult { member: MemberAccountRecord | null; existingUser: boolean }
export interface TenantDefaults { id: string; retentionDays: number; dataLifecyclePolicy: DataLifecyclePolicy; eventQuota: number }

export interface TenancyRepository {
  findMembershipForUpdate(tenantId: string, userId: string): Promise<MembershipRecord | null>
  findMembership(tenantId: string, userId: string): Promise<MembershipRecord | null>
  findUserIdByEmail(email: string): Promise<string | null>
  insertMembership(input: MembershipRecord): Promise<MembershipRecord>
  createMemberAccount(input: MemberAccountCreationInput): Promise<MemberAccountCreationResult>
  updateMembershipRole(input: MembershipRecord): Promise<MembershipRecord | null>
  deleteMembership(tenantId: string, userId: string): Promise<boolean>
  listMembers(tenantId: string): Promise<MemberAccessRecord[]>
  hasProjectAccess(tenantId: string, userId: string, projectId: string): Promise<boolean>
  replaceProjectAccess(input: { tenantId: string; actorUserId: string; targetUserId: string; projectIds: string[]; requestId?: string }): Promise<boolean>
  activeRetentionDaysMax(tenantId: string): Promise<number | null>
  readDefaults(tenantId: string): Promise<TenantDefaults | null>
  updateDefaults(input: { tenantId: string; actorUserId: string; retentionDays?: number; dataLifecyclePolicy?: DataLifecyclePolicy; eventQuota?: number; requestId?: string }): Promise<TenantDefaults | null>
}
