import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import projectAccess from '../../../app/middleware/projectAccess'

describe('project access middleware', () => {
  it('checks the authenticated tenant member and project before the controller runs', async () => {
    const calls: string[] = []
    const context = { tenantId: 'tenant', userId: 'user', role: 'member' as const }
    const ctx = {
      state: { auth: { userId: 'user' } }, params: { tenantId: 'tenant', projectId: 'project' },
      service: { tenancy: { index: {
        context: async (tenantId: string, userId: string) => { calls.push(`tenant:${tenantId}:${userId}`); return context },
        requireProject: async (value: typeof context, projectId: string) => { assert.equal(value, context); calls.push(`project:${projectId}`) },
      } } },
    }
    await projectAccess()(ctx as never, async () => { calls.push('controller') })
    assert.deepEqual(calls, [ 'tenant:tenant:user', 'project:project', 'controller' ])
  })

  it('does not run the controller when project access is denied', async () => {
    let controllerRan = false
    const ctx = {
      state: { auth: { userId: 'user' } }, params: { tenantId: 'tenant', projectId: 'project' },
      service: { tenancy: { index: {
        context: async () => ({ tenantId: 'tenant', userId: 'user', role: 'member' as const }),
        requireProject: async () => { throw Object.assign(new Error('not found'), { code: 'project_not_found' }) },
      } } },
    }
    await assert.rejects(() => projectAccess()(ctx as never, async () => { controllerRan = true }), { code: 'project_not_found' })
    assert.equal(controllerRan, false)
  })
})
