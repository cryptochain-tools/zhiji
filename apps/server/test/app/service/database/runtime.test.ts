import assert from 'node:assert/strict'
import { PgDatabaseRuntime } from '../../../../app/service/database/runtime'
import { PostgreSqlConnection, PostgreSqlDriver, QueryResult } from '../../../../app/service/database/types'

function result<Row extends object>(rows: Row[] = []): QueryResult<Row> {
  return { rows, rowCount: rows.length }
}

describe('PgDatabaseRuntime', () => {
  it('does not create a driver when DATABASE_URL is absent', async () => {
    const runtime = new PgDatabaseRuntime({})
    assert.equal(runtime.configured, false)
    assert.deepEqual(await runtime.checkReadiness(), {
      connected: false,
      schemaVersion: null,
      expectedSchemaVersion: '036_business_user_profiles',
      ready: false,
    })
    await assert.rejects(() => runtime.query('SELECT 1'), /DATABASE_URL is required/)
  })

  it('requires the current migration for readiness', async () => {
    const driver = new FakeDriver([
      result([{ connected: 1 }]),
      result([{ id: '036_business_user_profiles' }]),
    ])
    const runtime = new PgDatabaseRuntime(
      { databaseUrl: 'postgres://not-used-in-test/zhiji' },
      { createDriver: () => driver },
    )

    assert.deepEqual(await runtime.checkReadiness(), {
      connected: true,
      schemaVersion: '036_business_user_profiles',
      expectedSchemaVersion: '036_business_user_profiles',
      ready: true,
    })
    assert.deepEqual(driver.queries, [
      'SELECT 1 AS connected',
      'SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1',
    ])
  })

  it('rolls back and releases a transaction after a failure', async () => {
    const connection = new FakeConnection([])
    const driver = new FakeDriver([], connection)
    const runtime = new PgDatabaseRuntime(
      { databaseUrl: 'postgres://not-used-in-test/zhiji' },
      { createDriver: () => driver },
    )

    await assert.rejects(
      () => runtime.transaction(async transaction => {
        await transaction.query('SELECT failing_work')
        throw new Error('expected failure')
      }),
      /expected failure/,
    )

    assert.deepEqual(connection.queries, [ 'BEGIN', 'SELECT failing_work', 'ROLLBACK' ])
    assert.equal(connection.released, true)
  })
})

class FakeDriver implements PostgreSqlDriver {
  readonly queries: string[] = []
  private readonly results: Array<QueryResult<Record<string, unknown>>>
  private readonly connection: FakeConnection

  constructor(results: Array<QueryResult<Record<string, unknown>>>, connection = new FakeConnection([])) {
    this.results = results
    this.connection = connection
  }

  async query<Row extends object = Record<string, unknown>>(text: string): Promise<QueryResult<Row>> {
    this.queries.push(text)
    return (this.results.shift() ?? result()) as QueryResult<Row>
  }

  async connect(): Promise<PostgreSqlConnection> {
    return this.connection
  }

  async end(): Promise<void> {}
}

class FakeConnection implements PostgreSqlConnection {
  readonly queries: string[] = []
  released = false
  private readonly results: Array<QueryResult<Record<string, unknown>>>

  constructor(results: Array<QueryResult<Record<string, unknown>>>) {
    this.results = results
  }

  async query<Row extends object = Record<string, unknown>>(text: string): Promise<QueryResult<Row>> {
    this.queries.push(text)
    return (this.results.shift() ?? result()) as QueryResult<Row>
  }

  release(): void {
    this.released = true
  }
}
