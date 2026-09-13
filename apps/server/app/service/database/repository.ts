import {
  DatabaseClient,
  IngestDecision,
  IngestLane,
  IngestReceiptRecord,
  ProjectKeyRecord,
  RuntimeConfigRecord,
} from './types'

export class CoreDatabaseRepository {
  constructor(private readonly database: DatabaseClient) {}

  async lockActiveProjectKey(keyHash: Buffer): Promise<ProjectKeyRecord | null> {
    const result = await this.database.query<ProjectKeyRecord>(
      `SELECT id, tenant_id, project_id, key_type, label, prefix, key_hash, disabled_at
       FROM project_keys
       WHERE key_hash = $1 AND disabled_at IS NULL
       FOR UPDATE`,
      [ keyHash ],
    )
    return result.rows[0] ?? null
  }

  async insertReceipt(input: {
    tenantId: string
    projectId: string
    lane: IngestLane
    clientEventId: string
    decision: Exclude<IngestDecision, 'duplicate'>
  }): Promise<{ inserted: boolean; receipt: IngestReceiptRecord | null }> {
    const result = await this.database.query<IngestReceiptRecord>(
      `INSERT INTO ingest_receipts
         (tenant_id, project_id, lane, client_event_id, decision)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, project_id, lane, client_event_id) DO NOTHING
       RETURNING tenant_id, project_id, lane, client_event_id, received_at, decision`,
      [ input.tenantId, input.projectId, input.lane, input.clientEventId, input.decision ],
    )
    return { inserted: result.rowCount === 1, receipt: result.rows[0] ?? null }
  }

  async getRuntimeConfig(): Promise<RuntimeConfigRecord> {
    const result = await this.database.query<RuntimeConfigRecord>(
      `SELECT worker_enabled, sdk_config_max_age_seconds, updated_at
       FROM runtime_config
       WHERE singleton = true`,
    )
    const config = result.rows[0]
    if (!config) {
      throw new Error('runtime_config singleton is missing')
    }
    return config
  }
}
