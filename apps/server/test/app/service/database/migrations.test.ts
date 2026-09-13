import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMigrationFiles, runMigrations } from '../../../../app/service/database/migrations'
import { PostgreSqlConnection, PostgreSqlDriver, QueryResult } from '../../../../app/service/database/types'

describe('migration runner', () => {
  it('orders migration files and ignores non-migration files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhiji-migrations-'))
    try {
      await writeFile(join(directory, '010_second.sql'), 'SELECT 2;')
      await writeFile(join(directory, '001_first.sql'), 'SELECT 1;')
      await writeFile(join(directory, 'notes.sql'), 'SELECT 3;')
      const migrations = await readMigrationFiles(directory)
      assert.deepEqual(migrations.map(migration => migration.id), [ '001_first', '010_second' ])
      assert.equal(migrations[0]?.checksum.length, 64)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('records only migrations that are not already applied', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhiji-migrations-'))
    try {
      await writeFile(join(directory, '001_first.sql'), 'SELECT 1;')
      const connection = new FakeConnection()
      const driver = new FakeDriver(connection)
      const result = await runMigrations({ databaseUrl: 'postgres://not-used-in-test/zhiji', migrationsDirectory: directory }, driver)
      assert.deepEqual(result, { applied: [ '001_first' ], skipped: [] })
      assert.equal(connection.released, true)
      assert.equal(driver.ended, true)
      assert.ok(connection.calls.some(call => call.text.startsWith('INSERT INTO schema_migrations')))
      assert.deepEqual(connection.calls.filter(call => call.text === 'BEGIN').length, 1)
      assert.deepEqual(connection.calls.filter(call => call.text === 'COMMIT').length, 1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

class FakeDriver implements PostgreSqlDriver {
  ended = false
  private readonly connection: FakeConnection
  constructor(connection: FakeConnection) { this.connection = connection }
  async query<Row extends object = Record<string, unknown>>(): Promise<QueryResult<Row>> { return { rows: [], rowCount: 0 } }
  async connect(): Promise<PostgreSqlConnection> { return this.connection }
  async end(): Promise<void> { this.ended = true }
}

class FakeConnection implements PostgreSqlConnection {
  readonly calls: Array<{ text: string; values?: readonly unknown[] }> = []
  released = false
  async query<Row extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
    this.calls.push({ text, values })
    if (text.startsWith('SELECT id, checksum')) return { rows: [], rowCount: 0 } as QueryResult<Row>
    return { rows: [], rowCount: 0 }
  }
  release(): void { this.released = true }
}
