import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { DatabaseClient } from '../database/types'
import { AnalyticsScope, TrendPoint, parseDashboardQuery, parseEventsQuery, parseTrendQuery } from './contracts'
import { AnalyticsRepository } from './repository'

export interface TrendPointDto {
  bucket_start: string
  event_name: string
  event_count: number
  page_views: number
  visitors: number
}

/** Read-only management analytics. Query construction stays bounded in contracts.ts. */
export class AnalyticsManagementService {
  constructor(private readonly database: DatabaseClient) {}

  async trend(scope: AnalyticsScope, raw: unknown, now = new Date()): Promise<{ from: string; to: string; granularity: string; points: TrendPointDto[] }> {
    const query = parseTrendQuery(scope, normalizeTrendInput(raw), now)
    if (!query) throw httpError(400, 'invalid_analytics_query', 'Analytics trend query is invalid')
    const points = await new AnalyticsRepository(this.database).trend(query)
    return { from: query.from.toISOString(), to: query.to.toISOString(), granularity: query.granularity, points: points.map(pointDto) }
  }
  async dashboard(scope: AnalyticsScope, raw: unknown, now = new Date()) {
    const query = parseDashboardQuery(scope, raw, now)
    if (!query) throw httpError(400, 'invalid_analytics_query', 'Analytics dashboard query is invalid')
    const result = await new AnalyticsRepository(this.database).dashboard(query)
    return { from: query.from.toISOString(), to: query.to.toISOString(), granularity: query.granularity, summary: result.summary, core_event_series: result.points.map(pointDto), error_top10: result.errors }
  }
  async events(scope: AnalyticsScope, raw: unknown, now = new Date()) {
    const query = parseEventsQuery(scope, normalizeEventsInput(raw), now)
    if (!query) throw httpError(400, 'invalid_analytics_query', 'Analytics event query is invalid')
    const result = await new AnalyticsRepository(this.database).events(query)
    return { from: query.from.toISOString(), to: query.to.toISOString(), group_by: query.groupBy ?? 'name', items: result, truncated: result.length === query.limit }
  }
}

export default class AnalyticsService extends Service {
  private domain(): AnalyticsManagementService {
    const database = this.config.zhiji.database
    if (!database?.configured) throw httpError(503, 'analytics_unavailable', 'Analytics management is unavailable')
    return new AnalyticsManagementService(database)
  }
  trend(scope: AnalyticsScope, input: unknown) { return this.domain().trend(scope, input) }
  dashboard(scope: AnalyticsScope, input: unknown) { return this.domain().dashboard(scope, input) }
  events(scope: AnalyticsScope, input: unknown) { return this.domain().events(scope, input) }
}

/** HTTP query strings use comma-separated names; programmatic callers retain the JSON array contract. */
export function normalizeTrendInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (typeof record.event_names !== 'string') return record
  return { ...record, event_names: record.event_names.split(',').map(name => name.trim()).filter(Boolean) }
}

function normalizeEventsInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (typeof record.filters !== 'string') return record
  try { return { ...record, filters: JSON.parse(record.filters) } } catch { return { ...record, filters: null } }
}

function pointDto(point: TrendPoint): TrendPointDto {
  return {
    bucket_start: point.bucket_start.toISOString(),
    event_name: point.event_name,
    event_count: Number(point.event_count),
    page_views: Number(point.page_views),
    visitors: Number(point.visitors),
  }
}
