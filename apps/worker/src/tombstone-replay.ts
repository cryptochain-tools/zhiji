import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { DatabaseClient, PostgreSqlConnection } from '../../server/app/service/database/types'
import { LocalPrivateReplayArtifactStore, PrivateReplayArtifactStore, S3PrivateReplayArtifactStore } from '../../server/app/service/replay/artifacts'
import { s3ArtifactObjectStoreFromEnvironment } from '../../server/app/service/artifacts/s3'
import { anonymizeSubjectFacts, deleteProjectFacts, removeAllReplayArtifacts } from './lifecycle'

/**
 * Local-only disaster-recovery maintenance. A restored database may contain
 * data that was removed before the backup was taken. Tombstones are retained
 * precisely so an operator can run this command before making that restore
 * available. There is intentionally no HTTP route and no queue producer.
 */
export type TombstoneReplayOptions = {
  batchSize?: number
  maxBatches?: number
  dryRun?: boolean
  operatorLabel?: string
  after?: { effectiveAt: string; id: string }
}

type TransactionDriver = DatabaseClient & { connect(): Promise<PostgreSqlConnection> }
type TombstoneRow = {
  id: string
  tenant_id: string
  project_id: string
  subject_business_user_id: string | null
  project_deletion: boolean
  effective_at: Date
}

type Cursor = { effectiveAt: Date; id: string }
export type TombstoneReplayMetrics = {
  scanned: number
  replayed: number
  dryRun: boolean
  subjectTombstones: number
  projectTombstones: number
  recordsRemoved: number
  batches: number
  nextCursor: { effectiveAt: string; id: string } | null
}

const DEFAULT_BATCH_SIZE = 100
const MAX_BATCH_SIZE = 1_000

export class TombstoneReplayMaintenance {
  constructor(private readonly database: TransactionDriver, private readonly replayArtifacts?: PrivateReplayArtifactStore) {}

  async replay(options: TombstoneReplayOptions = {}): Promise<TombstoneReplayMetrics> {
    const batchSize = boundedPositive(options.batchSize ?? DEFAULT_BATCH_SIZE, 'batchSize', MAX_BATCH_SIZE)
    const maxBatches = boundedPositive(options.maxBatches ?? Number.MAX_SAFE_INTEGER, 'maxBatches', Number.MAX_SAFE_INTEGER)
    const dryRun = options.dryRun === true
    const operatorLabel = safeOperatorLabel(options.operatorLabel)
    let cursor = options.after ? parseCursor(options.after) : undefined
    const metrics: TombstoneReplayMetrics = { scanned: 0, replayed: 0, dryRun, subjectTombstones: 0, projectTombstones: 0, recordsRemoved: 0, batches: 0, nextCursor: null }

    while (metrics.batches < maxBatches) {
      const rows = await this.list(cursor, batchSize)
      if (rows.length === 0) break
      metrics.batches += 1
      for (const tombstone of rows) {
        metrics.scanned += 1
        if (tombstone.project_deletion) metrics.projectTombstones += 1
        else metrics.subjectTombstones += 1
        if (!dryRun) {
          metrics.recordsRemoved += await this.reapply(tombstone, operatorLabel)
          metrics.replayed += 1
        }
        cursor = { effectiveAt: tombstone.effective_at, id: tombstone.id }
      }
      metrics.nextCursor = cursor ? { effectiveAt: cursor.effectiveAt.toISOString(), id: cursor.id } : null
      if (rows.length < batchSize) break
    }
    return metrics
  }

  private async list(cursor: Cursor | undefined, limit: number): Promise<TombstoneRow[]> {
    if (!cursor) {
      return (await this.database.query<TombstoneRow>(
        `SELECT id, tenant_id, project_id, subject_business_user_id, project_deletion, effective_at
         FROM deletion_tombstones ORDER BY effective_at ASC, id ASC LIMIT $1`, [ limit ],
      )).rows
    }
    return (await this.database.query<TombstoneRow>(
      `SELECT id, tenant_id, project_id, subject_business_user_id, project_deletion, effective_at
       FROM deletion_tombstones
       WHERE (effective_at, id) > ($1, $2)
       ORDER BY effective_at ASC, id ASC LIMIT $3`, [ cursor.effectiveAt, cursor.id, limit ],
    )).rows
  }

  private async reapply(tombstone: TombstoneRow, operatorLabel: string | undefined): Promise<number> {
    return this.transaction(async transaction => {
      const locked = await transaction.query<TombstoneRow>(
        `SELECT id, tenant_id, project_id, subject_business_user_id, project_deletion, effective_at
         FROM deletion_tombstones WHERE id = $1 FOR UPDATE`, [ tombstone.id ],
      )
      const row = locked.rows[0]
      if (!row) return 0 // A concurrent maintenance run completed this scope.
      let removed: number
      if (row.project_deletion) {
        await transaction.query(
          `UPDATE projects SET deletion_status = 'deleted', updated_at = now()
           WHERE tenant_id = $1 AND id = $2 AND deletion_status <> 'deleted'`,
          [ row.tenant_id, row.project_id ],
        )
        await transaction.query('UPDATE project_keys SET disabled_at = COALESCE(disabled_at, now()) WHERE tenant_id = $1 AND project_id = $2', [ row.tenant_id, row.project_id ])
        await transaction.query(
          `UPDATE worker_jobs SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, finished_at = COALESCE(finished_at, now()),
                  last_error_code = COALESCE(last_error_code, 'project_deleted'), updated_at = now()
           WHERE tenant_id = $1 AND project_id = $2 AND status IN ('queued', 'running')`, [ row.tenant_id, row.project_id ],
        )
        await transaction.query(
          `UPDATE data_subject_jobs SET status = 'cancelled', finished_at = COALESCE(finished_at, now()), reason_code = COALESCE(reason_code, 'project_deleted')
           WHERE tenant_id = $1 AND project_id = $2 AND status IN ('queued', 'running')`, [ row.tenant_id, row.project_id ],
        )
        await transaction.query(
          `UPDATE outbox_messages SET discarded_at = now(), lease_owner = NULL, lease_expires_at = NULL,
                  last_error_code = 'project_deleted', updated_at = now()
           WHERE tenant_id = $1 AND project_id = $2 AND delivered_at IS NULL AND discarded_at IS NULL`, [ row.tenant_id, row.project_id ],
        )
        removed = await removeAllReplayArtifacts(transaction, this.replayArtifacts, { tenantId: row.tenant_id, projectId: row.project_id })
        removed += await deleteProjectFacts(transaction, row.tenant_id, row.project_id)
      } else {
        if (!row.subject_business_user_id) throw new Error('invalid_subject_tombstone')
        removed = await anonymizeSubjectFacts(transaction, row.tenant_id, row.project_id, row.subject_business_user_id)
      }
      await audit(transaction, row, removed, operatorLabel)
      return removed
    })
  }

  private async transaction<T>(run: (transaction: PostgreSqlConnection) => Promise<T>): Promise<T> {
    const connection = await this.database.connect()
    try {
      await connection.query('BEGIN')
      const value = await run(connection)
      await connection.query('COMMIT')
      return value
    } catch (error) {
      try { await connection.query('ROLLBACK') } catch { /* retain original failure */ }
      throw error
    } finally { connection.release() }
  }
}

async function audit(database: DatabaseClient, tombstone: TombstoneRow, removed: number, operatorLabel: string | undefined): Promise<void> {
  await database.query(
    `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1,$2,NULL,'deletion_tombstone_replayed_after_restore',$3,$4,$5::jsonb)`,
    [ randomUUID(), tombstone.tenant_id, tombstone.project_deletion ? 'project' : 'data_subject', tombstone.project_deletion ? tombstone.project_id : tombstone.id,
      JSON.stringify({ tombstone_id: tombstone.id, project_id: tombstone.project_id, subject_kind: tombstone.project_deletion ? 'project' : 'business_user', records_removed: removed, operator_label: operatorLabel ?? null }) ],
  )
}

function boundedPositive(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error(`invalid_tombstone_replay_${name}`)
  return value
}
function safeOperatorLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (!/^[a-zA-Z0-9._:@/-]{1,120}$/.test(value)) throw new Error('invalid_tombstone_replay_operator_label')
  return value
}

type CliOptions = TombstoneReplayOptions & { confirm: boolean; afterEffectiveAt?: string; afterId?: string }
function parseCliArguments(argv: readonly string[]): CliOptions {
  const result: CliOptions = { confirm: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--confirm-restore-tombstones') result.confirm = true
    else if (token === '--dry-run') result.dryRun = true
    else if (token === '--batch-size') result.batchSize = Number(argv[++index])
    else if (token === '--max-batches') result.maxBatches = Number(argv[++index])
    else if (token === '--operator-label') result.operatorLabel = argv[++index]
    else if (token === '--after-effective-at') result.afterEffectiveAt = argv[++index]
    else if (token === '--after-id') result.afterId = argv[++index]
    else throw new Error(`unknown_tombstone_replay_option:${token}`)
  }
  if ((result.afterEffectiveAt === undefined) !== (result.afterId === undefined)) throw new Error('invalid_tombstone_replay_after_cursor')
  if (result.afterEffectiveAt && result.afterId) result.after = { effectiveAt: result.afterEffectiveAt, id: result.afterId }
  return result
}

function parseCursor(value: { effectiveAt: string; id: string }): Cursor {
  const effectiveAt = new Date(value.effectiveAt)
  if (!Number.isFinite(effectiveAt.getTime()) || !isUuid(value.id)) throw new Error('invalid_tombstone_replay_after_cursor')
  return { effectiveAt, id: value.id.toLowerCase() }
}
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }

export async function runTombstoneReplayFromEnvironment(environment: NodeJS.ProcessEnv, argv: readonly string[]): Promise<TombstoneReplayMetrics> {
  const options = parseCliArguments(argv)
  if (!options.dryRun && !options.confirm) throw new Error('refusing_tombstone_replay_without_confirm_restore_tombstones')
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required for tombstone replay')
  const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 2 })
  try {
    const s3Artifacts = s3ArtifactObjectStoreFromEnvironment(environment)
    const directory = environment.REPLAY_ARTIFACT_DIR
    const artifacts = s3Artifacts ? new S3PrivateReplayArtifactStore(s3Artifacts) : directory ? new LocalPrivateReplayArtifactStore(directory) : undefined
    return await new TombstoneReplayMaintenance(pool as unknown as TransactionDriver, artifacts).replay(options)
  } finally { await pool.end() }
}

if (require.main === module) {
  void runTombstoneReplayFromEnvironment(process.env, process.argv.slice(2)).then(metrics => {
    process.stdout.write(`${JSON.stringify(metrics)}\n`)
  }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'tombstone replay failed'}\n`)
    process.exitCode = 1
  })
}
