import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { UsageScope, parseUsageQuery } from './contracts'
import { UsageLedgerRepository } from './repository'
import { UsageSubscriptionRepository } from './quota'
import { IngestLane } from '../database/types'

export class UsageManagementService {
  constructor(private readonly repository: UsageLedgerRepository) {}

  async show(scope: UsageScope, raw: unknown, now = new Date()) {
    const query = parseUsageQuery(raw, now)
    const daily = await this.repository.daily(scope, query)
    const totals = daily.reduce((total, row) => ({ received_events: total.received_events + row.received_events, received_bytes: total.received_bytes + row.received_bytes }), { received_events: 0, received_bytes: 0 })
    return { from: query.from.toISOString(), to: query.to.toISOString(), lane: query.lane ?? null, totals, daily }
  }
}

export default class UsageService extends Service {
  private domain(): UsageManagementService {
    if (!this.config.zhiji.database.configured) throw httpError(503, 'usage_unavailable', 'Usage is unavailable')
    return new UsageManagementService(new UsageLedgerRepository(this.config.zhiji.database))
  }
  show(scope: UsageScope, raw: unknown) { return this.domain().show(scope, raw) }

  async subscriptionSummary(tenantId: string) { return this.subscriptions().summary(tenantId) }
  async configureSubscription(tenantId: string, actorUserId: string, raw: unknown, requestId?: string) {
    const body = object(raw)
    const planId = body.plan_id === undefined ? undefined : uuid(body.plan_id, 'plan_id')
    const hardLimitEnabled = body.hard_limit_enabled === undefined ? undefined : boolean(body.hard_limit_enabled, 'hard_limit_enabled')
    const gracePercent = body.grace_percent === undefined ? undefined : integer(body.grace_percent, 'grace_percent', 0, 1000)
    if (planId === undefined && hardLimitEnabled === undefined && gracePercent === undefined) throw httpError(400, 'invalid_subscription_config', 'Subscription configuration is empty')
    return this.subscriptions().configure({ tenantId, actorUserId, planId, hardLimitEnabled, gracePercent, requestId })
  }
  async adjustUsage(tenantId: string, actorUserId: string, raw: unknown, requestId?: string) {
    const body = object(raw)
    const lane = laneValue(body.lane)
    const deltaEvents = body.delta_events === undefined ? 0 : signedInteger(body.delta_events, 'delta_events')
    const deltaBytes = body.delta_bytes === undefined ? 0 : signedInteger(body.delta_bytes, 'delta_bytes')
    const reason = typeof body.reason === 'string' && body.reason.trim().length >= 1 && body.reason.trim().length <= 500 ? body.reason.trim() : fail('invalid_usage_adjustment')
    if (deltaEvents === 0 && deltaBytes === 0) throw httpError(400, 'invalid_usage_adjustment', 'Usage adjustment is empty')
    const adjusted = await this.subscriptions().adjust({ tenantId, actorUserId, lane, deltaEvents, deltaBytes, reason, requestId })
    if (!adjusted) throw httpError(409, 'subscription_unavailable', 'An active subscription is required')
    return this.subscriptions().summary(tenantId)
  }
  private subscriptions(): UsageSubscriptionRepository {
    if (!this.config.zhiji.database.configured) throw httpError(503, 'usage_unavailable', 'Usage is unavailable')
    return new UsageSubscriptionRepository(this.config.zhiji.database)
  }
}

function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'invalid_subscription_config', 'Subscription configuration is invalid'); return value as Record<string, unknown> }
function uuid(value: unknown, field: string): string { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return fail(`invalid_${field}`); return value }
function boolean(value: unknown, field: string): boolean { if (typeof value !== 'boolean') return fail(`invalid_${field}`); return value }
function integer(value: unknown, field: string, min: number, max: number): number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) return fail(`invalid_${field}`); return value as number }
function signedInteger(value: unknown, field: string): number { return integer(value, field, -1_000_000_000_000, 1_000_000_000_000) }
function laneValue(value: unknown): IngestLane { if (value === 'analytics' || value === 'error' || value === 'behavior' || value === 'replay' || value === 'performance') return value; return fail('invalid_usage_adjustment') }
function fail(code: string): never { throw httpError(400, code, 'Usage configuration is invalid') }
