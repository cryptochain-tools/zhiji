export type MembershipRole = 'owner' | 'admin' | 'member' | 'viewer'
export type ProjectKeyType = 'browser' | 'server' | 'mobile' | 'otel' | 'sourcemap_upload'
export type IngestLane = 'analytics' | 'error' | 'behavior' | 'replay' | 'performance'
export type IngestDecision = 'accepted' | 'sampled' | 'rate_limited' | 'dropped' | 'duplicate'

/** Minimal driver contract. The application chooses and configures the PostgreSQL driver later. */
export interface DatabaseClient {
  query<Row extends object = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>
}

export interface QueryResult<Row extends object> {
  rows: Row[]
  rowCount: number | null
}

export interface DatabaseTransaction extends DatabaseClient {
  commit(): Promise<void>
  rollback(): Promise<void>
}

export interface DatabasePool extends DatabaseClient {
  transaction<T>(run: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>
}

/** Small pg-compatible surface so database behavior can be unit tested. */
export interface PostgreSqlConnection extends DatabaseClient {
  release(): void
}

export interface PostgreSqlDriver extends DatabaseClient {
  connect(): Promise<PostgreSqlConnection>
  end(): Promise<void>
}

export interface DatabaseRuntime extends DatabasePool {
  readonly configured: boolean
  checkReadiness(): Promise<DatabaseReadiness>
  close(): Promise<void>
}

export interface DatabaseReadiness {
  connected: boolean
  schemaVersion: string | null
  expectedSchemaVersion: string
  ready: boolean
}

export interface ProjectKeyRecord {
  id: string
  tenant_id: string
  project_id: string
  key_type: ProjectKeyType
  label: string
  prefix: string
  key_hash: Buffer
  disabled_at: Date | null
}

export interface IngestReceiptRecord {
  tenant_id: string
  project_id: string
  lane: IngestLane
  client_event_id: string
  received_at: Date
  decision: IngestDecision
}

export interface RuntimeConfigRecord {
  worker_enabled: boolean
  sdk_config_max_age_seconds: number
  updated_at: Date
}
