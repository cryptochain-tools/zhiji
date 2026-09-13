import { createHash } from 'node:crypto'
import { httpError } from '../../lib/http'
import { InsightDefinition, parseDefinition } from '../insights/contracts'

export interface ReportingScope { tenantId: string; projectId: string }
export type ExportFormat = 'csv' | 'xlsx'
export interface PerformanceQuery { from: Date; to: Date; metric?: string; pageKey?: string; release?: string }
export interface PerformanceDetailQuery { from: Date; to: Date; metric: PerformanceMetricName; pageKey: string }
export type PerformanceMetricName = 'CLS' | 'INP' | 'LCP' | 'FCP' | 'TTFB'

export function parsePerformanceQuery(raw: unknown, now = new Date()): PerformanceQuery {
  const value = object(raw)
  const to = value.to === undefined ? now : date(value.to)
  const from = value.from === undefined ? new Date(to.getTime() - 7 * 86_400_000) : date(value.from)
  if (from >= to || to.getTime() > now.getTime() + 300_000 || to.getTime() - from.getTime() > 90 * 86_400_000) throw httpError(400, 'invalid_performance_query', 'Performance date range is invalid')
  const metric = optionalText(value.metric, 10); if (metric && !isPerformanceMetric(metric)) throw httpError(400, 'invalid_performance_query', 'Performance metric is invalid')
  return { from, to, metric, pageKey: optionalText(value.page_key, 500), release: optionalText(value.release, 200) }
}

/** Page details are always scoped to the route page_key, never a caller-selected aggregate. */
export function parsePerformanceDetailQuery(raw: unknown, rawPageKey: unknown, now = new Date()): PerformanceDetailQuery {
  const query = parsePerformanceQuery(raw, now)
  if (!query.metric) throw httpError(400, 'invalid_performance_query', 'Performance detail metric is required')
  if (typeof rawPageKey !== 'string' || rawPageKey.length < 1 || rawPageKey.length > 500) throw httpError(400, 'invalid_performance_query', 'Performance page key is invalid')
  if (query.pageKey !== undefined && query.pageKey !== rawPageKey) throw httpError(400, 'invalid_performance_query', 'Performance page key does not match the route')
  return { from: query.from, to: query.to, metric: query.metric as PerformanceMetricName, pageKey: rawPageKey }
}

function isPerformanceMetric(value: string): value is PerformanceMetricName { return [ 'CLS', 'INP', 'LCP', 'FCP', 'TTFB' ].includes(value) }

export interface ExportTarget { type: 'insight' | 'dashboard'; id: string }
export function parseExportRequest(raw: unknown): { format: ExportFormat; definition?: InsightDefinition; target?: ExportTarget; queryHash: Buffer } {
  const value = object(raw)
  if (Object.keys(value).some(key => key !== 'format' && key !== 'definition' && key !== 'target')) throw httpError(400, 'invalid_export_request', 'Export request is invalid')
  if (value.format !== 'csv' && value.format !== 'xlsx') throw httpError(400, 'invalid_export_request', 'Export format is invalid')
  const target = targetInput(value.target)
  if ((value.definition === undefined) === (target === undefined)) throw httpError(400, 'invalid_export_request', 'Exactly one export definition or target is required')
  let definition: InsightDefinition | undefined
  if (value.definition !== undefined) { try { definition = parseDefinition(value.definition) } catch { throw httpError(400, 'invalid_export_request', 'Export definition is invalid') } }
  if (target?.type === 'dashboard' && value.format !== 'xlsx') throw httpError(400, 'invalid_export_request', 'Dashboard exports require xlsx')
  // The worker only receives a frozen, bounded definition; no SQL or raw rows are accepted.
  return { format: value.format, definition, target, queryHash: createHash('sha256').update(JSON.stringify(definition ?? target)).digest() }
}

export function escapeCsvCell(value: unknown): string {
  const text = String(value ?? '')
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
function object(raw: unknown): Record<string, unknown> { return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {} }
function optionalText(value: unknown, max: number): string | undefined { if (value === undefined) return undefined; if (typeof value !== 'string' || value.length < 1 || value.length > max) throw httpError(400, 'invalid_performance_query', 'Performance query is invalid'); return value }
function date(value: unknown): Date { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw httpError(400, 'invalid_performance_query', 'Performance date range is invalid'); return new Date(value) }

function targetInput(value: unknown): ExportTarget | undefined { if (value === undefined) return undefined; const target = object(value); if ((target.type !== 'insight' && target.type !== 'dashboard') || typeof target.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target.id) || Object.keys(target).some(key => key !== 'type' && key !== 'id')) throw httpError(400, 'invalid_export_request', 'Export target is invalid'); return { type: target.type, id: target.id } }
