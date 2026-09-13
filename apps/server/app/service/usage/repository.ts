import { DatabaseClient } from '../database/types'
import { UsageDaily, UsageQuery, UsageScope } from './contracts'

export interface AcceptedUsage extends UsageScope { lane: UsageDaily['lane']; receivedAt: Date; receivedBytes: number }

/**
 * The daily table is an optimization only.  `ingest_receipts` remains the
 * immutable source for accepted counts and canonical bytes, so this repository
 * can rebuild any bounded project range without consulting identity tables.
 */
export class UsageLedgerRepository {
  constructor(private readonly database: DatabaseClient) {}

  async recordAccepted(input: AcceptedUsage): Promise<void> {
    await this.database.query(`INSERT INTO usage_ledger_daily
      (tenant_id, project_id, usage_date, lane, received_events, received_bytes)
      VALUES ($1,$2,($3::timestamptz AT TIME ZONE 'UTC')::date,$4,1,$5)
      ON CONFLICT (tenant_id, project_id, usage_date, lane)
      DO UPDATE SET received_events = usage_ledger_daily.received_events + 1,
                    received_bytes = usage_ledger_daily.received_bytes + EXCLUDED.received_bytes,
                    updated_at = now()`, [ input.tenantId, input.projectId, input.receivedAt, input.lane, input.receivedBytes ])
  }

  async daily(scope: UsageScope, query: UsageQuery): Promise<UsageDaily[]> {
    const result = await this.database.query<UsageDaily>(`SELECT usage_date::text AS usage_date, lane, received_events, received_bytes
      FROM usage_ledger_daily
      WHERE tenant_id = $1 AND project_id = $2 AND usage_date >= ($3::timestamptz AT TIME ZONE 'UTC')::date
        AND usage_date < ($4::timestamptz AT TIME ZONE 'UTC')::date
        AND ($5::text IS NULL OR lane = $5)
      ORDER BY usage_date ASC, lane ASC`, [ scope.tenantId, scope.projectId, query.from, query.to, query.lane ?? null ])
    return result.rows.map(row => ({ ...row, received_events: Number(row.received_events), received_bytes: Number(row.received_bytes) }))
  }

  /** Maintenance-only helper. Call it from a transaction while the scope is quiesced. */
  async rebuild(scope: UsageScope, query: UsageQuery): Promise<void> {
    const values = [ scope.tenantId, scope.projectId, query.from, query.to, query.lane ?? null ]
    await this.database.query(`DELETE FROM usage_ledger_daily
      WHERE tenant_id = $1 AND project_id = $2 AND usage_date >= ($3::timestamptz AT TIME ZONE 'UTC')::date
        AND usage_date < ($4::timestamptz AT TIME ZONE 'UTC')::date AND ($5::text IS NULL OR lane = $5)`, values)
    await this.database.query(`INSERT INTO usage_ledger_daily (tenant_id, project_id, usage_date, lane, received_events, received_bytes)
      SELECT tenant_id, project_id, (received_at AT TIME ZONE 'UTC')::date, lane, count(*), coalesce(sum(received_bytes), 0)
      FROM ingest_receipts
      WHERE tenant_id = $1 AND project_id = $2 AND decision = 'accepted' AND received_bytes IS NOT NULL
        AND received_at >= $3 AND received_at < $4 AND ($5::text IS NULL OR lane = $5)
      GROUP BY tenant_id, project_id, (received_at AT TIME ZONE 'UTC')::date, lane`, values)
  }
}
