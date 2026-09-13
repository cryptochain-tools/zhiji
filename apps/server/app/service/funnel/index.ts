import { Service } from 'egg'
import { createHash } from 'node:crypto'
import { httpError } from '../../lib/http'
import { FunnelScope, FunnelStepCount, parseFunnelQuery } from './contracts'
import { FunnelRepository } from './repository'

export interface FunnelStepDto { name: string; count: number; conversion: number; dropoff: number }

export class FunnelManagementService {
  constructor(private readonly database: import('../database/types').DatabaseClient) {}

  async show(scope: FunnelScope, raw: unknown, now = new Date()): Promise<{ from: string; to: string; timezone: 'UTC'; subject_kind: string; identity_attribution: 'all_linked'; facts_deduplicated: true; source_event_count: number; query_hash: string; computed_at: string; truncated: false; steps: FunnelStepDto[] }> {
    const query = parseFunnelQuery(scope, normalizeFunnelInput(raw), now)
    const result = await new FunnelRepository(this.database).counts(query)
    return {
      from: query.from.toISOString(), to: query.to.toISOString(), subject_kind: query.subjectKind,
      timezone: 'UTC', identity_attribution: 'all_linked', facts_deduplicated: true,
      source_event_count: result.sourceEventCount, query_hash: queryHash(query), computed_at: now.toISOString(), truncated: false,
      steps: presentation(result.steps),
    }
  }
}

export default class FunnelService extends Service {
  private domain(): FunnelManagementService {
    const database = this.config.zhiji.database
    if (!database?.configured) throw httpError(503, 'funnel_unavailable', 'Funnel analysis is unavailable')
    return new FunnelManagementService(database)
  }
  show(scope: FunnelScope, input: unknown) { return this.domain().show(scope, input) }
}

/** GET query strings encode the ordered steps as a comma-separated list. */
export function normalizeFunnelInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (typeof record.steps !== 'string') return record
  return { ...record, steps: record.steps.split(',').map(step => step.trim()) }
}

function presentation(counts: readonly FunnelStepCount[]): FunnelStepDto[] {
  return counts.map((current, index) => {
    const previous = index === 0 ? undefined : counts[index - 1]
    if (!previous) return { name: current.name, count: current.count, conversion: current.count === 0 ? 0 : 100, dropoff: 0 }
    return {
      name: current.name,
      count: current.count,
      conversion: previous.count === 0 ? 0 : percentage(current.count, previous.count),
      dropoff: Math.max(0, previous.count - current.count),
    }
  })
}

function percentage(current: number, previous: number): number { return Math.round((current / previous) * 10_000) / 100 }

function queryHash(query: { tenantId: string; projectId: string; from: Date; to: Date; steps: readonly string[]; subjectKind: string }): string {
  return createHash('sha256').update(JSON.stringify({
    tenant_id: query.tenantId, project_id: query.projectId, from: query.from.toISOString(), to: query.to.toISOString(),
    steps: query.steps, subject_kind: query.subjectKind,
  })).digest('hex')
}
