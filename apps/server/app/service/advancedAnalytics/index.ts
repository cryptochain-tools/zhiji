import { createHash } from 'node:crypto'
import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { AdvancedAnalyticsScope, parsePathQuery, parseRetentionQuery, PathQuery, RetentionQuery } from './contracts'
import { AdvancedAnalyticsRepository, PathRow, RetentionRow } from './repository'

export interface RetentionCohortDto { cohort_start: string; cohort_size: number; retained: Array<{ period: number; count: number; rate: number }> }
export interface PathNodeDto { parent_path: string[]; name: string; count: number }
export interface PathLevelDto { depth: number; nodes: PathNodeDto[]; other_count: number }
interface ResponseMetadata { from: string; to: string; subject_kind: string; timezone: string; identity_attribution: 'all_linked'; facts_deduplicated: true; source_event_count: number; query_hash: string; computed_at: string; truncated: false }
export interface RetentionResponse extends ResponseMetadata { kind: 'retention'; period: string; period_count: number; start_event: string; return_event: string; cohorts: RetentionCohortDto[] }
export interface PathResponse extends ResponseMetadata { kind: 'path'; start_event: string; depth: number; levels: PathLevelDto[] }

export class AdvancedAnalyticsManagementService {
  constructor(private readonly database: import('../database/types').DatabaseClient) {}

  async retention(scope: AdvancedAnalyticsScope, input: unknown, now = new Date()): Promise<RetentionResponse> {
    const query = parseRetentionQuery(scope, input, now)
    const result = await new AdvancedAnalyticsRepository(this.database).retention(query)
    return metadata(query, now, result.sourceEventCount, {
      kind: 'retention' as const,
      period: query.period,
      period_count: query.periodCount,
      start_event: query.startEvent,
      return_event: query.returnEvent,
      cohorts: result.rows.map(retentionCohort),
    })
  }

  async path(scope: AdvancedAnalyticsScope, input: unknown, now = new Date()): Promise<PathResponse> {
    const query = parsePathQuery(scope, input, now)
    const result = await new AdvancedAnalyticsRepository(this.database).path(query)
    return metadata(query, now, result.sourceEventCount, {
      kind: 'path' as const,
      start_event: query.startEvent,
      depth: query.depth,
      levels: pathLevels(result.rows),
    })
  }
}

export default class AdvancedAnalyticsService extends Service {
  private domain(): AdvancedAnalyticsManagementService {
    const database = this.config.zhiji.database
    if (!database?.configured) throw httpError(503, 'advanced_analytics_unavailable', 'Advanced analytics is unavailable')
    return new AdvancedAnalyticsManagementService(database)
  }
  retention(scope: AdvancedAnalyticsScope, input: unknown) { return this.domain().retention(scope, input) }
  path(scope: AdvancedAnalyticsScope, input: unknown) { return this.domain().path(scope, input) }
}

function retentionCohort(row: RetentionRow): RetentionCohortDto {
  return {
    cohort_start: row.cohortBucket.toISOString(), cohort_size: row.cohortSize,
    retained: row.retained.map((count, index) => ({ period: index + 1, count, rate: percentage(count, row.cohortSize) })),
  }
}

/** Limit each parent independently; every omitted sibling is represented by Other. */
function pathLevels(rows: readonly PathRow[]): PathLevelDto[] {
  const byDepth = new Map<number, PathRow[]>()
  for (const row of rows) {
    const current = byDepth.get(row.depth) ?? []
    current.push(row)
    byDepth.set(row.depth, current)
  }
  return [ ...byDepth.entries() ].sort(([left], [right]) => left - right).map(([depth, level]) => {
    const byParent = new Map<string, PathRow[]>()
    for (const row of level) {
      const key = JSON.stringify(row.parentPath)
      const current = byParent.get(key) ?? []
      current.push(row)
      byParent.set(key, current)
    }
    let otherCount = 0
    const nodes: PathNodeDto[] = []
    for (const siblings of byParent.values()) {
      siblings.sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
      for (const row of siblings.slice(0, 10)) nodes.push({ parent_path: row.parentPath, name: row.name, count: row.count })
      otherCount += siblings.slice(10).reduce((sum, row) => sum + row.count, 0)
    }
    return { depth, nodes: nodes.sort((left, right) => pathKey(left).localeCompare(pathKey(right)) || right.count - left.count || left.name.localeCompare(right.name)), other_count: otherCount }
  })
}

function pathKey(value: PathNodeDto): string { return JSON.stringify(value.parent_path) }
function percentage(count: number, total: number): number { return total === 0 ? 0 : Math.round((count / total) * 10_000) / 100 }
function metadata<T extends object>(query: RetentionQuery | PathQuery, now: Date, sourceEventCount: number, result: T): ResponseMetadata & T {
  return {
    from: query.from.toISOString(), to: query.to.toISOString(), subject_kind: query.subjectKind,
    timezone: 'timezone' in query ? query.timezone : 'UTC', identity_attribution: 'all_linked' as const, facts_deduplicated: true as const,
    source_event_count: sourceEventCount, query_hash: createHash('sha256').update(JSON.stringify(queryHashInput(query))).digest('hex'),
    computed_at: now.toISOString(), truncated: false as const, ...result,
  }
}
function queryHashInput(query: RetentionQuery | PathQuery): Record<string, unknown> {
  const { tenantId, projectId, from, to, subjectKind } = query
  return { ...query, tenantId, projectId, from: from.toISOString(), to: to.toISOString(), subjectKind }
}
