import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { LifecycleManagementService } from '../../../../app/service/lifecycle'
import { LifecycleRequestVerifier } from '../../../../app/service/lifecycle/types'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'
import { PrivateExportArtifactStore } from '../../../../app/service/reporting/artifacts'

const tenantId = '20000000-0000-4000-8000-000000000001'
const projectId = '20000000-0000-4000-8000-000000000002'
const actorUserId = '20000000-0000-4000-8000-000000000003'
const jobId = '20000000-0000-4000-8000-000000000004'
const now = new Date('2026-09-12T12:00:00.000Z')

const verifier: LifecycleRequestVerifier = {
  async verify() { return { method: 'owner_reauthenticated', reauthenticatedAt: now } },
}

const artifacts: PrivateExportArtifactStore = {
  async put() { return { ref: 'subject-export/20000000-0000-4000-8000-000000000005.json', byteCount: 1 } },
  async read() { return Buffer.from('{}') },
  async remove() {},
}

function subjectRow(inserted = true) {
  return { id: jobId, requested_by: actorUserId, kind: 'subject_export', status: 'queued', subject_business_user_id: 'account-42', verification_method: 'owner_reauthenticated', reauthenticated_at: now, created_at: now, started_at: null, finished_at: null, expires_at: new Date(now.getTime() + 86_400_000), reason_code: null, inserted }
}

describe('LifecycleManagementService', () => {
  it('returns an existing subject request before consuming another one-time proof', async () => {
    let verificationCalls = 0
    const database: DatabaseClient = { async query<Row extends object>(text: string): Promise<QueryResult<Row>> {
      if (text.includes('FROM data_subject_jobs') && text.includes('idempotency_key')) return { rows: [ subjectRow(false) as Row ], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    } }
    const service = new LifecycleManagementService(database, { async verify() { verificationCalls += 1; return null } }, () => now, artifacts)
    const result = await service.requestSubjectExport(
      { tenantId, projectId, actorUserId, role: 'owner' },
      'request-1',
      { subject_business_user_id: 'account-42', purpose: 'requested export', proof: 'already-consumed-proof' },
    )
    assert.equal(result.idempotent, true)
    assert.equal(result.job.id, jobId)
    assert.equal(verificationCalls, 0)
  })

  it('requires trusted proof, creates a scoped subject job, schedules it, and audits only a safe summary', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = { async query<Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
      calls.push({ text, values })
      if (text.startsWith('SELECT id FROM projects')) return { rows: [{ id: projectId } as Row], rowCount: 1 }
      if (text.includes('INSERT INTO data_subject_jobs')) return { rows: [ subjectRow() as Row ], rowCount: 1 }
      if (text.includes('INSERT INTO worker_jobs')) return { rows: [{ id: jobId, inserted: true } as Row], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    } }
    const service = new LifecycleManagementService(database, verifier, () => now, artifacts)
    const result = await service.requestSubjectExport({ tenantId, projectId, actorUserId, role: 'owner' }, 'request-1', {
      subject_business_user_id: 'account-42', purpose: 'requested export', proof: 'proof-opaque-value',
    }, 'request-id-1')
    assert.equal(result.job.id, jobId)
    assert.equal(result.job.subject_business_user_id, 'account-42')
    assert.equal(calls.find(call => call.text.includes('INSERT INTO worker_jobs'))?.values?.[3], 'subject_export')
    const workerJobs = calls.filter(call => call.text.includes('INSERT INTO worker_jobs'))
    assert.equal(workerJobs.length, 2)
    assert.equal(workerJobs[1]?.values?.[3], 'artifact_cleanup')
    assert.equal((workerJobs[1]?.values?.[6] as Date).getTime(), result.job.expires_at ? Date.parse(result.job.expires_at) : NaN)
    const audit = calls.find(call => call.text.includes('INSERT INTO audit_logs'))
    assert.ok(audit)
    const auditText = JSON.stringify(audit?.values)
    assert.equal(auditText.includes('proof-opaque-value'), false)
    assert.equal(auditText.includes('requested export'), false)
    assert.equal(auditText.includes('account-42'), false)
  })

  it('never accepts a browser-provided reauthentication claim when the verifier does not confirm it', async () => {
    const queries: string[] = []
    const database: DatabaseClient = { async query<Row extends object>(text: string): Promise<QueryResult<Row>> { queries.push(text); return { rows: [], rowCount: 0 } } }
    const service = new LifecycleManagementService(database, { async verify() { return null } }, () => now, artifacts)
    await assert.rejects(() => service.requestSubjectDeletion({ tenantId, projectId, actorUserId, role: 'owner' }, 'request-1', {
      subject_business_user_id: 'account-42', purpose: 'delete', proof: 'client-says-reauthenticated', reauthenticated_at: now.toISOString(),
    }), (error: Error & { code?: string }) => error.code === 'lifecycle_verification_required')
    assert.equal(queries.length, 1)
    assert.match(queries[0] ?? '', /idempotency_key/)
    assert.equal(queries.some(text => text.includes('INSERT INTO data_subject_jobs')), false)
  })

  it('only permits a non-owner subject flow when the trusted verifier identifies a verified subject', async () => {
    const database: DatabaseClient = { async query<Row extends object>(text: string): Promise<QueryResult<Row>> {
      if (text.startsWith('SELECT id FROM projects')) return { rows: [{ id: projectId } as Row], rowCount: 1 }
      if (text.includes('INSERT INTO data_subject_jobs')) return { rows: [ subjectRow() as Row ], rowCount: 1 }
      if (text.includes('INSERT INTO worker_jobs')) return { rows: [{ id: jobId, inserted: true } as Row], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    } }
    const service = new LifecycleManagementService(database, { async verify() { return { method: 'verified_subject', reauthenticatedAt: now } } }, () => now, artifacts)
    await service.requestSubjectDeletion({ tenantId, projectId, actorUserId, role: 'viewer' }, 'request-1', { subject_business_user_id: 'account-42', purpose: 'delete', proof: 'opaque-proof' })
    const denied = new LifecycleManagementService(database, verifier, () => now, artifacts)
    await assert.rejects(() => denied.requestSubjectDeletion({ tenantId, projectId, actorUserId, role: 'viewer' }, 'request-2', { subject_business_user_id: 'account-42', purpose: 'delete', proof: 'opaque-proof' }), (error: Error & { code?: string }) => error.code === 'subject_request_not_authorized')
  })

  it('freezes project writes, disables keys, and schedules deletion only after the cancellation window', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const deletion = { id: jobId, status: 'pending', effective_at: new Date(now.getTime() + 7 * 86_400_000), created_at: now, cancelled_at: null, inserted: true }
    const database: DatabaseClient = { async query<Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
      calls.push({ text, values })
      if (text.includes('FROM project_deletion_requests') && text.includes('idempotency_key')) return { rows: [], rowCount: 0 }
      if (text.startsWith('SELECT id FROM projects')) return { rows: [{ id: projectId } as Row], rowCount: 1 }
      if (text.includes('WITH created AS')) return { rows: [ deletion as Row ], rowCount: 1 }
      if (text.includes('INSERT INTO worker_jobs')) return { rows: [{ id: jobId, inserted: true } as Row], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    } }
    const service = new LifecycleManagementService(database, verifier, () => now, artifacts)
    const result = await service.requestProjectDeletion({ tenantId, projectId, actorUserId, role: 'owner' }, 'project-request-1', { confirmation: 'DELETE_PROJECT', purpose: 'retire project', proof: 'opaque-proof' })
    assert.equal(result.deletion.status, 'pending')
    const freeze = calls.find(call => call.text.includes('UPDATE projects SET deletion_status'))
    assert.ok(freeze)
    assert.match(freeze?.text ?? '', /UPDATE project_keys AS keys SET disabled_at/)
    const work = calls.find(call => call.text.includes('INSERT INTO worker_jobs'))
    assert.equal(work?.values?.[6] instanceof Date, true)
    assert.equal((work?.values?.[6] as Date).getTime(), deletion.effective_at.getTime())
  })

  it('requires the exact irreversible project confirmation and owner role', async () => {
    const database: DatabaseClient = { async query<Row extends object>(): Promise<QueryResult<Row>> { return { rows: [], rowCount: 0 } } }
    const service = new LifecycleManagementService(database, verifier, () => now, artifacts)
    await assert.rejects(() => service.requestProjectDeletion({ tenantId, projectId, actorUserId, role: 'admin' }, 'x', { confirmation: 'DELETE_PROJECT', purpose: 'x', proof: 'x' }), (error: Error & { code?: string }) => error.code === 'tenant_action_denied')
    await assert.rejects(() => service.requestProjectDeletion({ tenantId, projectId, actorUserId, role: 'owner' }, 'x', { confirmation: 'delete', purpose: 'x', proof: 'x' }), (error: Error & { code?: string }) => error.code === 'invalid_project_deletion')
  })
})
