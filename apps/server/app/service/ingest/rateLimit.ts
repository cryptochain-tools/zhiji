import { IngestLane } from '../../contracts/ingest'
import { DatabaseClient } from '../database/types'

export interface IngestRateLimitInput {
  tenantId: string
  projectId: string
  projectKeyId: string
  lane: IngestLane
}

/** The limiter is deliberately separate from plan or usage quota accounting. */
export interface IngestRateLimiter {
  consume(input: IngestRateLimitInput): Promise<boolean>
}

/**
 * Limits requests, rather than events, because each accepted request is already
 * independently bounded by the ingress payload-size and event-count contracts.
 */
export const INGEST_REQUESTS_PER_MINUTE: Readonly<Record<IngestLane, number>> = {
  analytics: 120,
  error: 120,
  behavior: 120,
  performance: 120,
  replay: 30,
}

/**
 * A single UPSERT owns the current fixed-minute bucket. PostgreSQL evaluates
 * the conflict predicate while holding the row lock, so concurrent processes
 * cannot pass the same limit. The table retains only the current bucket per
 * key/project/lane instead of accumulating historical counter rows.
 */
export class PostgreSqlIngestRateLimiter implements IngestRateLimiter {
  constructor(private readonly database: DatabaseClient, private readonly limits = INGEST_REQUESTS_PER_MINUTE) {}

  async consume(input: IngestRateLimitInput): Promise<boolean> {
    const limit = this.limits[input.lane]
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('ingest rate limit is invalid')
    const result = await this.database.query(
      `INSERT INTO ingest_rate_limit_buckets
        (tenant_id, project_id, project_key_id, lane, window_started_at, request_count, updated_at)
       VALUES ($1, $2, $3, $4, date_trunc('minute', statement_timestamp()), 1, statement_timestamp())
       ON CONFLICT (tenant_id, project_id, project_key_id, lane) DO UPDATE
       SET window_started_at = CASE
             WHEN ingest_rate_limit_buckets.window_started_at = date_trunc('minute', statement_timestamp())
             THEN ingest_rate_limit_buckets.window_started_at
             ELSE date_trunc('minute', statement_timestamp())
           END,
           request_count = CASE
             WHEN ingest_rate_limit_buckets.window_started_at = date_trunc('minute', statement_timestamp())
             THEN ingest_rate_limit_buckets.request_count + 1
             ELSE 1
           END,
           updated_at = statement_timestamp()
       WHERE ingest_rate_limit_buckets.window_started_at <> date_trunc('minute', statement_timestamp())
          OR ingest_rate_limit_buckets.request_count < $5
       RETURNING request_count`,
      [ input.tenantId, input.projectId, input.projectKeyId, input.lane, limit ],
    )
    return result.rowCount === 1
  }
}
