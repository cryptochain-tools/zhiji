import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { hashProjectKey, ProjectsDomainService } from '../../../../app/service/projects'
import { ProjectKeyRecord, ProjectRecord, ProjectStore, TenantDefaults } from '../../../../app/service/projects/types'

const tenantId = '20000000-0000-4000-8000-000000000001'
const projectId = '20000000-0000-4000-8000-000000000002'
const owner = { tenantId, userId: '00000000-0000-4000-8000-000000000099', role: 'owner' as const }

class MemoryProjectStore implements ProjectStore {
  retentionDaysMax: number | null = null
  readonly defaults: TenantDefaults = { retention_days: 365, data_lifecycle_policy: { raw_event_days: 365, error_occurrence_days: 90, behavior_raw_days: 14, replay_raw_days: 7, performance_raw_days: 30, aggregate_days: 365, backup_expiry_days: 30 }, event_quota: 100000 }
  readonly projects = new Map<string, ProjectRecord>()
  readonly keys = new Map<string, ProjectKeyRecord>()

  async getTenantDefaults(id: string) { return id === tenantId ? this.defaults : null }
  async activeRetentionDaysMax(id: string) { return id === tenantId ? this.retentionDaysMax : null }
  async getProject(tid: string, id: string) { return tid === tenantId ? this.projects.get(id) ?? null : null }
  async listProjects(tid: string) { return tid === tenantId ? [ ...this.projects.values() ] : [] }
  async createProject(record: ProjectRecord) { this.projects.set(record.id, record) }
  async updateProject(record: ProjectRecord) { this.projects.set(record.id, record) }
  async listKeys(tid: string, pid: string) { return [ ...this.keys.values() ].filter(key => key.tenant_id === tid && key.project_id === pid) }
  async getKey(tid: string, pid: string, id: string) { const key = this.keys.get(id); return key?.tenant_id === tid && key.project_id === pid ? key : null }
  async createKey(record: ProjectKeyRecord) { this.keys.set(record.id, record) }
  async disableKey(tid: string, pid: string, id: string, disabledAt: Date) {
    const key = await this.getKey(tid, pid, id)
    if (!key) return null
    const disabled = { ...key, disabled_at: disabledAt }
    this.keys.set(id, disabled)
    return disabled
  }
}

describe('ProjectsDomainService', () => {
  it('derives effective policy server-side and only lets owners create projects', async () => {
    const store = new MemoryProjectStore()
    const service = new ProjectsDomainService(store)
    const project = await service.create(owner, {
      name: ' Web production ', allowed_origins: [ 'https://app.example.test', 'https://app.example.test' ],
      core_event_names: [ 'signup' ], policy: { retention_days: null, event_quota: 500 },
      page_capture: { allowed_page_keys: [ '/pricing' ], route_templates: [ '/orders/:orderId' ] },
    })
    assert.equal(project.name, 'Web production')
    assert.deepEqual(project.allowed_origins, [ 'https://app.example.test' ])
    assert.deepEqual(project.page_capture, { allowed_page_keys: [ '/pricing' ], route_templates: [ '/orders/:orderId' ] })
    assert.deepEqual(project.policy, {
      retention_days: { configured: null, effective: 365, source: 'tenant_default' },
      data_lifecycle_policy: { configured: null, effective: { raw_event_days: 365, error_occurrence_days: 90, behavior_raw_days: 14, replay_raw_days: 7, performance_raw_days: 30, aggregate_days: 365, backup_expiry_days: 30 }, source: 'tenant_default' },
      event_quota: { configured: 500, effective: 500, source: 'project_override' },
      enforcement_enabled: false,
    })
    await assert.rejects(
      service.create({ tenantId, userId: '00000000-0000-4000-8000-000000000098', role: 'viewer' }, { name: 'Nope' }),
      (error: Error & { code?: string }) => error.code === 'forbidden',
    )
    await assert.rejects(
      service.create({ tenantId, userId: '00000000-0000-4000-8000-000000000097', role: 'admin' }, { name: 'Admin project' }),
      (error: Error & { code?: string }) => error.code === 'forbidden',
    )
  })

  it('keeps project key plaintext out of storage and disables old key while rotating', async () => {
    const store = new MemoryProjectStore()
    const service = new ProjectsDomainService(store)
    const project = await service.create(owner, { name: 'Web' })
    const first = await service.createKey(owner, project.id, { label: 'Browser', key_type: 'browser' })
    const storedFirst = await store.getKey(tenantId, project.id, first.key.id)
    assert.ok(storedFirst)
    assert.deepEqual(storedFirst.key_hash, hashProjectKey(first.secret))
    assert.equal(JSON.stringify(storedFirst).includes(first.secret), false)
    assert.match(first.secret, /^zj_bro_/)

    const next = await service.rotateKey(owner, project.id, first.key.id, { label: 'Rotated browser' })
    const disabled = await store.getKey(tenantId, project.id, first.key.id)
    assert.ok(disabled?.disabled_at)
    assert.notEqual(next.secret, first.secret)
    await assert.rejects(
      service.rotateKey(owner, project.id, first.key.id, {}),
      (error: Error & { code?: string }) => error.code === 'key_already_rotated',
    )
  })

  it('keeps an enabled behavior page allowlist inside the project page boundary', async () => {
    const store = new MemoryProjectStore()
    const service = new ProjectsDomainService(store)
    const behavior = { enabled: true, policy_version: 1, page_allowlist: [ '/orders/:orderId' ], track_ids: [], block_selectors: [], sample_rate: 1 }
    const project = await service.create(owner, { name: 'Behavior', page_capture: { allowed_page_keys: [ '/pricing' ], route_templates: [ '/orders/:orderId' ] }, behavior_capture: behavior })
    assert.deepEqual(project.behavior_capture, behavior)
    await assert.rejects(
      service.update(owner, project.id, { behavior_capture: { ...behavior, policy_version: 2, page_allowlist: [ '/checkout' ] } }),
      (error: Error & { code?: string }) => error.code === 'invalid_policy',
    )
    await assert.rejects(
      service.update(owner, project.id, { page_capture: { allowed_page_keys: [ '/pricing' ], route_templates: [] } }),
      (error: Error & { code?: string }) => error.code === 'invalid_policy',
    )
  })

  it('persists a complete lifecycle override but never exposes a longer fixed raw-data period', async () => {
    const store = new MemoryProjectStore(); const service = new ProjectsDomainService(store)
    const project = await service.create(owner, { name: 'Lifecycle', policy: { data_lifecycle_policy: { raw_event_days: 730, error_occurrence_days: 365, behavior_raw_days: 365, replay_raw_days: 365, performance_raw_days: 365, aggregate_days: 730, backup_expiry_days: 90 } } })
    assert.equal(project.policy.data_lifecycle_policy.configured?.replay_raw_days, 365)
    assert.equal(project.policy.data_lifecycle_policy.effective.replay_raw_days, 7)
    assert.equal(project.policy.data_lifecycle_policy.effective.behavior_raw_days, 14)
    assert.equal((await store.getProject(tenantId, project.id))?.data_lifecycle_policy?.aggregate_days, 730)
  })

  it('rejects project retention overrides above an active plan limit', async () => {
    const store = new MemoryProjectStore(); store.retentionDaysMax = 365
    const service = new ProjectsDomainService(store)
    await assert.rejects(
      service.create(owner, { name: 'Over plan', policy: { data_lifecycle_policy: { raw_event_days: 366, error_occurrence_days: 90, behavior_raw_days: 14, replay_raw_days: 7, performance_raw_days: 30, aggregate_days: 365, backup_expiry_days: 30 } } }),
      (error: Error & { code?: string }) => error.code === 'retention_limit_exceeded',
    )
  })

  it('does not leak keys across project scope', async () => {
    const store = new MemoryProjectStore()
    const service = new ProjectsDomainService(store)
    const project = await service.create(owner, { name: 'Scoped' })
    const key = await service.createKey(owner, project.id, { label: 'Upload', key_type: 'sourcemap_upload' })
    await assert.rejects(
      service.disableKey(owner, projectId, key.key.id),
      (error: Error & { code?: string }) => error.code === 'key_not_found',
    )
  })
})
