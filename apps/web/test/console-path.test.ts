import assert from 'node:assert/strict'
import test from 'node:test'
import { consolePath, isConsolePath } from '../src/console-path'

test('console pages use their own namespace, separate from API requests', () => {
  assert.equal(consolePath('/'), '/console')
  assert.equal(consolePath('/tenant-settings'), '/console/tenant-settings')
  assert.equal(consolePath('/console/alerts?project_id=123'), '/console/alerts?project_id=123')
  assert.equal(isConsolePath('/console/tenant-settings'), true)
  assert.equal(isConsolePath('/api/auth/me'), false)
  assert.equal(isConsolePath('/api/console/tenant-settings'), false)
  assert.equal(isConsolePath('/console-other'), false)
})
