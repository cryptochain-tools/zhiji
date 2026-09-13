import assert from 'node:assert/strict'
import test from 'node:test'
import { LifecycleJobHandlers, removeSubjectExportArtifacts } from '../src/lifecycle'
import { LeasedWorkerJob } from '../../server/app/service/worker'
import { PostgreSqlConnection } from '../../server/app/service/database/types'
import { PrivateExportArtifactStore } from '../../server/app/service/reporting/artifacts'

const tenantId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const jobId = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'

class RecordingDatabase {
  readonly statements: string[] = []
  readonly values: readonly unknown[][] = []
  constructor(private readonly projectRequest = false) {}
  private readonly connection: PostgreSqlConnection = {
    query: async <Row extends object>(text: string, values?: readonly unknown[]) => {
      this.statements.push(text)
      this.values.push(values ?? [])
      if (text.includes("kind='subject_export' AND artifact_ref IS NOT NULL")) return { rows: [] as Row[], rowCount: 0 }
      if (text.includes('FROM projects JOIN tenants')) return { rows: [ { data_lifecycle_policy: null, retention_days: 365 } as Row ], rowCount: 1 }
      if (this.projectRequest && text.includes('FROM project_deletion_requests')) return { rows: [ {
        id: requestId, requested_by: '55555555-5555-4555-8555-555555555555', status: 'pending', effective_at: new Date(Date.now() - 1),
      } ] as Row[], rowCount: 1 }
      if (text.includes('FROM data_subject_jobs')) return { rows: [ {
        id: requestId, requested_by: '55555555-5555-4555-8555-555555555555', subject_business_user_id: 'account-42', status: 'queued', expires_at: new Date(Date.now() + 60_000),
      } ] as Row[], rowCount: 1 }
      if (text.includes("FROM projects WHERE") && text.includes("deletion_status = 'active'")) return { rows: [ { id: projectId } ] as Row[], rowCount: 1 }
      return { rows: [] as Row[], rowCount: 1 }
    },
    release: () => undefined,
  }
  async connect(): Promise<PostgreSqlConnection> { return this.connection }
}

function job(kind: LeasedWorkerJob['kind'], payload: Record<string, unknown>): LeasedWorkerJob {
  return { id: jobId, tenant_id: tenantId, project_id: projectId, kind, idempotency_key: 'test', payload, watermark: {}, lease_owner: 'test', lease_expires_at: new Date(), attempt_count: 1, max_attempts: 10, processed_count: 0, failed_count: 0 }
}

test('subject export is terminally failed when no private artifact store exists', async () => {
  const database = new RecordingDatabase()
  const result = await new LifecycleJobHandlers(database).runJob(job('subject_export', { data_subject_job_id: requestId }))
  assert.equal(result.failedCount, 1)
  assert.ok(database.statements.some(text => text.includes("status = 'failed'") && text.includes('reason_code = $2')))
  assert.ok(database.values.some(values => values.includes('subject_export_failed')))
  assert.ok(database.statements.includes('COMMIT'))
})

test('subject export writes a bounded private JSON artifact and never puts its handle in audit values', async () => {
  const database = new RecordingDatabase()
  const artifacts: PrivateExportArtifactStore = {
    async put(input) { assert.equal(input.kind, 'subject-export'); assert.equal(input.format, 'json'); assert.match(input.contents.toString('utf8'), /"subject_business_user_id":"account-42"/); return { ref: 'subject-export/55555555-5555-4555-8555-555555555555.json', byteCount: input.contents.length } },
    async read() { return null }, async remove() {},
  }
  const result = await new LifecycleJobHandlers(database, undefined, artifacts).runJob(job('subject_export', { data_subject_job_id: requestId }))
  assert.equal(result.failedCount, 0)
  assert.ok(database.statements.some(text => text.includes('FROM business_user_profiles')))
  assert.ok(database.statements.some(text => text.includes('artifact_ref = $2') && text.includes("status = 'completed'")))
  const audit = database.values.find(values => values.includes('subject_export_completed'))
  assert.ok(audit)
  assert.equal(JSON.stringify(audit).includes('subject-export/'), false)
})

test('subject deletion writes a tombstone before anonymizing subject snapshots and deleting only identity relationships', async () => {
  const database = new RecordingDatabase()
  const result = await new LifecycleJobHandlers(database).runJob(job('subject_deletion', { data_subject_job_id: requestId }))
  assert.equal(result.failedCount, 0)
  const tombstone = database.statements.findIndex(text => text.includes('INSERT INTO deletion_tombstones'))
  const eventAnonymize = database.statements.findIndex(text => text.includes('UPDATE events SET business_user_id = NULL'))
  const completed = database.statements.findIndex(text => text.includes("status = 'completed'"))
  assert.ok(tombstone >= 0 && tombstone < eventAnonymize && eventAnonymize < completed)
  const tombstoneValues = database.values[tombstone]
  assert.equal(tombstoneValues?.[5], 30)
  assert.ok(database.statements.some(text => text.includes('UPDATE replay_sessions SET business_user_id = NULL')))
  assert.ok(database.statements.some(text => text.includes('DELETE FROM identities')))
  assert.ok(database.statements.some(text => text.includes('DELETE FROM business_user_profiles')))
  assert.equal(database.statements.some(text => text.includes('DELETE FROM events')), false)
  assert.ok(database.values.some(values => values.includes('subject_deletion_completed')))
})

test('malformed lifecycle job payload aborts before a transaction starts', async () => {
  const database = new RecordingDatabase()
  await assert.rejects(() => new LifecycleJobHandlers(database).runJob(job('subject_deletion', { data_subject_job_id: 'not-a-uuid' })), /invalid_lifecycle_payload/)
  assert.equal(database.statements.length, 0)
})

test('project deletion cancels pending work, deletes dependencies in batches, and retains its tombstone', async () => {
  const database = new RecordingDatabase(true)
  const result = await new LifecycleJobHandlers(database).runJob(job('project_deletion', { project_deletion_request_id: requestId }))
  assert.equal(result.failedCount, 0)
  const tombstone = database.statements.findIndex(text => text.includes('INSERT INTO deletion_tombstones'))
  const chunks = database.statements.findIndex(text => text.includes('SELECT id, artifact_ref FROM replay_chunks'))
  const sessions = database.statements.findIndex(text => text.includes('DELETE FROM replay_sessions'))
  const finish = database.statements.findIndex(text => text.includes("deletion_status = 'deleted'"))
  assert.ok(tombstone >= 0 && tombstone < chunks && chunks < sessions && sessions < finish)
  assert.ok(database.statements.some(text => text.includes('DELETE FROM alert_rule_targets')))
  assert.ok(database.statements.some(text => text.includes('DELETE FROM business_user_profiles')))
  assert.ok(database.statements.some(text => text.includes("status = 'cancelled'")))
  assert.ok(database.values.some(values => values.includes('project_deletion_completed')))
})

test('project deletion artifact cleanup refuses to complete if a prior subject export exists but its private store is unavailable', async () => {
  const database = { async query<Row extends object>() { return { rows: [ { id: requestId } as Row ], rowCount: 1 } } }
  await assert.rejects(() => removeSubjectExportArtifacts(database, undefined, { tenantId, projectId }), /subject_export_artifact_store_unavailable/)
})
