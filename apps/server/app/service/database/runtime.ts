import { Pool, PoolConfig } from 'pg'
import {
  DatabaseReadiness,
  DatabaseRuntime,
  DatabaseTransaction,
  PostgreSqlConnection,
  PostgreSqlDriver,
  QueryResult,
} from './types'

/** The ready endpoint may only turn green after all application facts exist. */
export const CURRENT_SCHEMA_VERSION = '037_user_journey_identity_index'

export interface DatabaseRuntimeOptions {
  databaseUrl?: string
  maxConnections?: number
  idleTimeoutMillis?: number
  connectionTimeoutMillis?: number
  expectedSchemaVersion?: string
}

export interface DatabaseRuntimeDependencies {
  createDriver?: (config: PoolConfig) => PostgreSqlDriver
}

class PostgreSqlTransaction implements DatabaseTransaction {
  private finished = false

  constructor(private readonly connection: PostgreSqlConnection) {}

  async query<Row extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
    return this.connection.query<Row>(text, values)
  }

  async commit(): Promise<void> {
    this.ensureOpen()
    await this.connection.query('COMMIT')
    this.finished = true
  }

  async rollback(): Promise<void> {
    if (this.finished) return
    await this.connection.query('ROLLBACK')
    this.finished = true
  }

  release(): void {
    this.connection.release()
  }

  private ensureOpen(): void {
    if (this.finished) throw new Error('database transaction has already finished')
  }
}

export class PgDatabaseRuntime implements DatabaseRuntime {
  private readonly expectedSchemaVersion: string
  private readonly driver: PostgreSqlDriver | null

  constructor(options: DatabaseRuntimeOptions, dependencies: DatabaseRuntimeDependencies = {}) {
    this.expectedSchemaVersion = options.expectedSchemaVersion ?? CURRENT_SCHEMA_VERSION
    if (!options.databaseUrl) {
      this.driver = null
      return
    }
    const config: PoolConfig = {
      connectionString: options.databaseUrl,
      max: options.maxConnections ?? 10,
      idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
      connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    }
    this.driver = (dependencies.createDriver ?? createPgDriver)(config)
  }

  get configured(): boolean {
    return this.driver !== null
  }

  async query<Row extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
    return this.requireDriver().query<Row>(text, values)
  }

  async transaction<T>(run: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    const connection = await this.requireDriver().connect()
    const transaction = new PostgreSqlTransaction(connection)
    try {
      await connection.query('BEGIN')
      const result = await run(transaction)
      await transaction.commit()
      return result
    } catch (error) {
      await transaction.rollback()
      throw error
    } finally {
      transaction.release()
    }
  }

  async checkReadiness(): Promise<DatabaseReadiness> {
    if (!this.driver) return this.notReady(null)
    try {
      const connectivity = await this.driver.query<{ connected: number }>('SELECT 1 AS connected')
      if (connectivity.rows[0]?.connected !== 1) return this.notReady(null)
      const version = await this.driver.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1')
      const schemaVersion = version.rows[0]?.id ?? null
      return {
        connected: true,
        schemaVersion,
        expectedSchemaVersion: this.expectedSchemaVersion,
        ready: schemaVersion === this.expectedSchemaVersion,
      }
    } catch {
      return this.notReady(null)
    }
  }

  async close(): Promise<void> {
    if (this.driver) await this.driver.end()
  }

  private requireDriver(): PostgreSqlDriver {
    if (!this.driver) throw new Error('DATABASE_URL is required for database access')
    return this.driver
  }

  private notReady(schemaVersion: string | null): DatabaseReadiness {
    return { connected: false, schemaVersion, expectedSchemaVersion: this.expectedSchemaVersion, ready: false }
  }
}

export function databaseRuntimeOptionsFromEnvironment(environment: NodeJS.ProcessEnv): DatabaseRuntimeOptions {
  return {
    databaseUrl: environment.DATABASE_URL,
    maxConnections: readPositiveInteger(environment.DATABASE_POOL_MAX, 10),
    idleTimeoutMillis: readPositiveInteger(environment.DATABASE_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: readPositiveInteger(environment.DATABASE_CONNECT_TIMEOUT_MS, 5_000),
  }
}

export function createDatabaseRuntimeFromEnvironment(environment: NodeJS.ProcessEnv): PgDatabaseRuntime {
  return new PgDatabaseRuntime(databaseRuntimeOptionsFromEnvironment(environment))
}

function createPgDriver(config: PoolConfig): PostgreSqlDriver {
  return new Pool(config) as unknown as PostgreSqlDriver
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('database pool environment values must be positive integers')
  return parsed
}
