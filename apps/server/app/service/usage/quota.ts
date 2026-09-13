import { randomUUID } from 'node:crypto'
import { DatabasePool, DatabaseTransaction } from '../database/types'
import { IngestLane } from '../database/types'

export interface UsageQuotaInput {
  tenantId: string
  lane: IngestLane
  acceptedEvents: number
  acceptedBytes: number
}

export interface UsageQuotaEnforcer {
  /** Called in the same fact transaction after an idempotency receipt is claimed. */
  consume(transaction: DatabaseTransaction, input: UsageQuotaInput): Promise<void>
}

/** A commercial quota rejection.  Transport maps only this error to 429. */
export class QuotaExceededError extends Error {
  constructor(readonly resetsAt: Date) { super('Commercial usage quota exceeded') }
}

interface SubscriptionRow {
  id: string
  cycle_started_at: Date
  cycle_ends_at: Date
  hard_limit_enabled: boolean
  grace_percent: number
  included_events: number
  included_errors: number
  included_behavior_events: number
  included_replay_bytes: number
}
interface CounterRow { accepted_events: number; accepted_bytes: number; adjustment_events: number; adjustment_bytes: number }

/**
 * A tenant subscription row is locked before its current cycle counter is
 * read/updated. This is intentionally independent from the request safety
 * rate limiter: a disabled hard limit still records commercial usage.
 */
export class PostgreSqlUsageQuotaEnforcer implements UsageQuotaEnforcer {
  async consume(transaction: DatabaseTransaction, input: UsageQuotaInput): Promise<void> {
    if (!Number.isSafeInteger(input.acceptedEvents) || !Number.isSafeInteger(input.acceptedBytes) || input.acceptedEvents < 0 || input.acceptedBytes < 0) {
      throw new Error('usage quota input is invalid')
    }
    const subscription = await transaction.query<SubscriptionRow>(`SELECT s.id, s.cycle_started_at, s.cycle_ends_at, s.hard_limit_enabled, s.grace_percent,
        p.included_events, p.included_errors, p.included_behavior_events, p.included_replay_bytes
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.tenant_id = $1 AND s.status = 'active' AND s.cycle_started_at <= now() AND s.cycle_ends_at > now()
      FOR UPDATE OF s`, [ input.tenantId ])
    const active = subscription.rows[0]
    // A pre-migration or deliberately paused tenant has no commercial quota.
    // It must never fail closed because a billing configuration is unavailable.
    if (!active) return
    const prior = await transaction.query<CounterRow>(`SELECT accepted_events, accepted_bytes, adjustment_events, adjustment_bytes
      FROM usage_cycle_counters WHERE tenant_id = $1 AND subscription_id = $2 AND cycle_started_at = $3 AND lane = $4 FOR UPDATE`,
    [ input.tenantId, active.id, active.cycle_started_at, input.lane ])
    const current = prior.rows[0] ?? { accepted_events: 0, accepted_bytes: 0, adjustment_events: 0, adjustment_bytes: 0 }
    const limit = laneLimit(active, input.lane)
    const measure = input.lane === 'replay' ? 'bytes' : 'events'
    const next = measure === 'bytes'
      ? number(current.accepted_bytes) + number(current.adjustment_bytes) + input.acceptedBytes
      : number(current.accepted_events) + number(current.adjustment_events) + input.acceptedEvents
    if (active.hard_limit_enabled && limit !== null && next > withGrace(limit, number(active.grace_percent))) {
      throw new QuotaExceededError(new Date(active.cycle_ends_at))
    }
    await transaction.query(`INSERT INTO usage_cycle_counters
        (tenant_id, subscription_id, cycle_started_at, lane, accepted_events, accepted_bytes)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (tenant_id, subscription_id, cycle_started_at, lane)
      DO UPDATE SET accepted_events = usage_cycle_counters.accepted_events + EXCLUDED.accepted_events,
                    accepted_bytes = usage_cycle_counters.accepted_bytes + EXCLUDED.accepted_bytes,
                    updated_at = now()`, [ input.tenantId, active.id, active.cycle_started_at, input.lane, input.acceptedEvents, input.acceptedBytes ])
  }
}

export interface PlanSummary {
  id: string; code: string; name: string
  included_events: number; included_errors: number; included_behavior_events: number; included_replay_bytes: number
  retention_days_max: number; export_concurrency: number; member_limit: number
}
export interface UsageCycleSummary {
  subscription_id: string; cycle_started_at: string; cycle_ends_at: string; hard_limit_enabled: boolean; grace_percent: number
  plan: PlanSummary; counters: Array<{ lane: IngestLane; accepted_events: number; accepted_bytes: number; adjustment_events: number; adjustment_bytes: number }>
}

interface SummaryRow extends SubscriptionRow {
  plan_id: string; code: string; name: string; retention_days_max: number; export_concurrency: number; member_limit: number
  lane: IngestLane | null; accepted_events: number | null; accepted_bytes: number | null; adjustment_events: number | null; adjustment_bytes: number | null
}

/** Owner-only administrative operations. None communicate with a payment provider. */
export class UsageSubscriptionRepository {
  constructor(private readonly database: DatabasePool) {}

  async summary(tenantId: string): Promise<UsageCycleSummary | null> {
    const result = await this.database.query<SummaryRow>(`SELECT s.id, s.cycle_started_at, s.cycle_ends_at, s.hard_limit_enabled, s.grace_percent,
        p.id AS plan_id, p.code, p.name, p.included_events, p.included_errors, p.included_behavior_events, p.included_replay_bytes, p.retention_days_max, p.export_concurrency, p.member_limit,
        c.lane, c.accepted_events, c.accepted_bytes, c.adjustment_events, c.adjustment_bytes
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      LEFT JOIN usage_cycle_counters c ON c.tenant_id = s.tenant_id AND c.subscription_id = s.id AND c.cycle_started_at = s.cycle_started_at
      WHERE s.tenant_id = $1 AND s.status = 'active' AND s.cycle_started_at <= now() AND s.cycle_ends_at > now()
      ORDER BY c.lane ASC`, [ tenantId ])
    const first = result.rows[0]
    if (!first) return null
    return {
      subscription_id: first.id, cycle_started_at: iso(first.cycle_started_at), cycle_ends_at: iso(first.cycle_ends_at), hard_limit_enabled: first.hard_limit_enabled, grace_percent: number(first.grace_percent),
      plan: { id: first.plan_id, code: first.code, name: first.name, included_events: number(first.included_events), included_errors: number(first.included_errors), included_behavior_events: number(first.included_behavior_events), included_replay_bytes: number(first.included_replay_bytes), retention_days_max: number(first.retention_days_max), export_concurrency: number(first.export_concurrency), member_limit: number(first.member_limit) },
      counters: result.rows.filter(row => row.lane !== null).map(row => ({ lane: row.lane!, accepted_events: number(row.accepted_events), accepted_bytes: number(row.accepted_bytes), adjustment_events: number(row.adjustment_events), adjustment_bytes: number(row.adjustment_bytes) })),
    }
  }

  async configure(input: { tenantId: string; actorUserId: string; planId?: string; hardLimitEnabled?: boolean; gracePercent?: number; requestId?: string }): Promise<UsageCycleSummary | null> {
    const updated = await this.database.transaction(async transaction => {
      const updated = await transaction.query<{ id: string }>(`UPDATE subscriptions SET plan_id = COALESCE($2, plan_id), hard_limit_enabled = COALESCE($3, hard_limit_enabled), grace_percent = COALESCE($4, grace_percent), updated_at = now()
        WHERE tenant_id = $1 AND status = 'active' AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM plans WHERE id = $2 AND active)) RETURNING id`, [ input.tenantId, input.planId ?? null, input.hardLimitEnabled ?? null, input.gracePercent ?? null ])
      if (!updated.rows[0]) return false
      await audit(transaction, input.tenantId, input.actorUserId, 'subscription_configured', updated.rows[0].id, { ...(input.planId ? { plan_id: input.planId } : {}), ...(input.hardLimitEnabled !== undefined ? { hard_limit_enabled: input.hardLimitEnabled } : {}), ...(input.gracePercent !== undefined ? { grace_percent: input.gracePercent } : {}) }, input.requestId)
      return true
    })
    return updated ? this.summary(input.tenantId) : null
  }

  async adjust(input: { tenantId: string; actorUserId: string; lane: IngestLane; deltaEvents: number; deltaBytes: number; reason: string; requestId?: string }): Promise<boolean> {
    return this.database.transaction(async transaction => {
      const subscriptions = await transaction.query<{ id: string; cycle_started_at: Date }>(`SELECT id, cycle_started_at FROM subscriptions WHERE tenant_id = $1 AND status = 'active' AND cycle_started_at <= now() AND cycle_ends_at > now() FOR UPDATE`, [ input.tenantId ])
      const subscription = subscriptions.rows[0]
      if (!subscription) return false
      const adjustmentId = randomUUID()
      await transaction.query(`INSERT INTO usage_cycle_counters (tenant_id, subscription_id, cycle_started_at, lane, adjustment_events, adjustment_bytes)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (tenant_id, subscription_id, cycle_started_at, lane)
        DO UPDATE SET adjustment_events = usage_cycle_counters.adjustment_events + EXCLUDED.adjustment_events,
                      adjustment_bytes = usage_cycle_counters.adjustment_bytes + EXCLUDED.adjustment_bytes, updated_at = now()`, [ input.tenantId, subscription.id, subscription.cycle_started_at, input.lane, input.deltaEvents, input.deltaBytes ])
      await transaction.query(`INSERT INTO usage_adjustments (id, tenant_id, subscription_id, cycle_started_at, lane, delta_events, delta_bytes, reason, actor_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [ adjustmentId, input.tenantId, subscription.id, subscription.cycle_started_at, input.lane, input.deltaEvents, input.deltaBytes, input.reason, input.actorUserId ])
      await audit(transaction, input.tenantId, input.actorUserId, 'usage_adjusted', adjustmentId, { lane: input.lane, delta_events: input.deltaEvents, delta_bytes: input.deltaBytes, reason: input.reason }, input.requestId)
      return true
    })
  }
}

function laneLimit(row: SubscriptionRow, lane: IngestLane): number | null {
  if (lane === 'analytics') return number(row.included_events)
  if (lane === 'error') return number(row.included_errors)
  if (lane === 'behavior') return number(row.included_behavior_events)
  if (lane === 'replay') return number(row.included_replay_bytes)
  return null
}
function withGrace(limit: number, percent: number): number { return Math.floor(limit * (100 + percent) / 100) }
function number(value: number | string | null): number { const parsed = Number(value ?? 0); if (!Number.isSafeInteger(parsed)) throw new Error('usage counter exceeds safe integer range'); return parsed }
function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString() }
async function audit(transaction: DatabaseTransaction, tenantId: string, actorUserId: string, action: string, targetId: string, metadata: Record<string, unknown>, requestId?: string) {
  await transaction.query(`INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, target_type, target_id, request_id, metadata)
    VALUES ($1,$2,$3,$4,'subscription',$5,$6,$7::jsonb)`, [ randomUUID(), tenantId, actorUserId, action, targetId, requestId ?? null, JSON.stringify(metadata) ])
}
