import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Pool, PoolConfig } from 'pg'
import { databaseRuntimeOptionsFromEnvironment } from './runtime'
import { PostgreSqlConnection, PostgreSqlDriver } from './types'

export interface MigrationFile { id: string; sql: string; checksum: string }
export interface MigrationRunResult { applied: string[]; skipped: string[] }
export interface MigrationRunnerOptions { databaseUrl: string; migrationsDirectory?: string }

export async function readMigrationFiles(directory: string): Promise<MigrationFile[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const names = entries.filter(entry => entry.isFile() && /^\d+_[a-z0-9_]+\.sql$/.test(entry.name)).map(entry => entry.name).sort()
  return Promise.all(names.map(async name => {
    const sql = await fs.readFile(join(directory, name), 'utf8')
    return { id: name.slice(0, -4), sql, checksum: createHash('sha256').update(sql).digest('hex') }
  }))
}

/** Explicit deployment command only; application boot never calls this function. */
export async function runMigrations(options: MigrationRunnerOptions, driver: PostgreSqlDriver = createMigrationDriver({ connectionString: options.databaseUrl })): Promise<MigrationRunResult> {
  const migrations = await readMigrationFiles(options.migrationsDirectory ?? defaultMigrationsDirectory())
  const connection = await driver.connect()
  try {
    await connection.query("SELECT pg_advisory_lock(hashtext('zhiji-schema-migrations'))")
    await ensureMigrationTable(connection)
    const appliedRows = await connection.query<{ id: string; checksum: string }>('SELECT id, checksum FROM schema_migrations ORDER BY id ASC')
    const appliedChecksums = new Map(appliedRows.rows.map(row => [ row.id, row.checksum ]))
    const result: MigrationRunResult = { applied: [], skipped: [] }
    for (const migration of migrations) {
      const existingChecksum = appliedChecksums.get(migration.id)
      if (existingChecksum) {
        if (existingChecksum !== migration.checksum) throw new Error(`migration checksum mismatch: ${migration.id}`)
        result.skipped.push(migration.id)
        continue
      }
      await applyMigration(connection, migration)
      result.applied.push(migration.id)
    }
    return result
  } finally {
    try { await connection.query("SELECT pg_advisory_unlock(hashtext('zhiji-schema-migrations'))") } finally {
      connection.release()
      await driver.end()
    }
  }
}

export async function runMigrationsFromEnvironment(environment: NodeJS.ProcessEnv): Promise<MigrationRunResult> {
  const { databaseUrl } = databaseRuntimeOptionsFromEnvironment(environment)
  if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations')
  return runMigrations({ databaseUrl })
}

export function defaultMigrationsDirectory(): string { return join(__dirname, '../../../migrations') }

async function ensureMigrationTable(connection: PostgreSqlConnection): Promise<void> {
  await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
}

async function applyMigration(connection: PostgreSqlConnection, migration: MigrationFile): Promise<void> {
  let transactionOpen = false
  try {
    await connection.query('BEGIN')
    transactionOpen = true
    await connection.query(stripOuterTransaction(migration.sql))
    await connection.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [ migration.id, migration.checksum ])
    await connection.query('COMMIT')
    transactionOpen = false
  } catch (error) {
    if (transactionOpen) await connection.query('ROLLBACK')
    throw error
  }
}

/**
 * The initial schema deliberately documents its transaction boundary. The
 * runner owns the actual transaction so schema changes and their migration
 * record commit together, including after an interrupted deployment.
 */
function stripOuterTransaction(sql: string): string {
  const withoutBegin = sql.replace(/^(?:\s|--[^\n]*(?:\n|$))*BEGIN\s*;\s*/i, '')
  if (withoutBegin === sql) return sql
  const withoutCommit = withoutBegin.replace(/\s*COMMIT\s*;\s*$/i, '')
  if (withoutCommit === withoutBegin) {
    throw new Error('migration has BEGIN without a final COMMIT')
  }
  return withoutCommit
}

function createMigrationDriver(config: PoolConfig): PostgreSqlDriver { return new Pool(config) as unknown as PostgreSqlDriver }
