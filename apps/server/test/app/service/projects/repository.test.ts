import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { PostgresProjectStore } from '../../../../app/service/projects/repository'
import type { DatabaseClient, QueryResult } from '../../../../app/service/database/types'

describe('PostgresProjectStore project visibility', () => {
  it('filters project lists by user grant unless the owner flag is set', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const database: DatabaseClient = { query: async <Row extends object>(text: string, values?: readonly unknown[]) => { calls.push({ text, values }); return { rows: [], rowCount: 0 } as QueryResult<Row> } }
    const store = new PostgresProjectStore(database)
    await store.listProjects('tenant', 'member', false)
    await store.listProjects('tenant', 'owner', true)
    assert.match(calls[0]!.text, /EXISTS \(\s*SELECT 1 FROM project_memberships/)
    assert.deepEqual(calls[0]!.values, [ 'tenant', 'member', false ])
    assert.deepEqual(calls[1]!.values, [ 'tenant', 'owner', true ])
  })
})
