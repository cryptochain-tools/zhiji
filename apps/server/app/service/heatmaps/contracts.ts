import { createHash } from 'node:crypto'
import { httpError } from '../../lib/http'

export interface HeatmapScope { tenantId: string; projectId: string }
export const HEATMAP_ACTIONS = [ 'autocapture_click', 'autocapture_submit', 'autocapture_change', 'scroll_depth', 'rage_click', 'dead_click' ] as const
export type HeatmapAction = typeof HEATMAP_ACTIONS[number]
export interface HeatmapQuery { from: Date; to: Date; pageKey: string; pageVersion?: string; viewportWidthBucket?: number; action?: HeatmapAction }
export interface HeatmapId { pageKey: string; pageVersion: string; viewportWidthBucket: number; action: HeatmapAction }

export function parseHeatmapQuery(raw: unknown, now = new Date()): HeatmapQuery {
  const value = record(raw)
  const to = value.to === undefined ? now : date(value.to)
  const from = value.from === undefined ? new Date(to.getTime() - 7 * 86_400_000) : date(value.from)
  if (from >= to || to.getTime() > now.getTime() + 300_000 || to.getTime() - from.getTime() > 30 * 86_400_000) throw invalid()
  const pageKey = text(value.page_key, 512)
  if (!pageKey.startsWith('/') || /[?#@]/.test(pageKey)) throw invalid()
  const pageVersion = value.page_version === undefined ? undefined : text(value.page_version, 200)
  const viewportWidthBucket = value.viewport_width_bucket === undefined ? undefined : bucket(value.viewport_width_bucket)
  const action = value.action === undefined ? undefined : actionValue(value.action)
  return { from, to, pageKey, ...(pageVersion === undefined ? {} : { pageVersion }), ...(viewportWidthBucket === undefined ? {} : { viewportWidthBucket }), ...(action === undefined ? {} : { action }) }
}

export function encodeHeatmapId(value: HeatmapId): string {
  const body = JSON.stringify([value.pageKey, value.pageVersion, value.viewportWidthBucket, value.action])
  return Buffer.from(body, 'utf8').toString('base64url')
}
export function parseHeatmapId(value: unknown): HeatmapId {
  if (typeof value !== 'string' || value.length < 8 || value.length > 1500 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid()
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!Array.isArray(decoded) || decoded.length !== 4) throw invalid()
    const [pageKey, pageVersion, width, action] = decoded
    if (typeof pageKey !== 'string' || !pageKey.startsWith('/') || /[?#@]/.test(pageKey) || pageKey.length > 512 || typeof pageVersion !== 'string' || pageVersion.length > 200) throw invalid()
    return { pageKey, pageVersion, viewportWidthBucket: bucket(width), action: actionValue(action) }
  } catch (error) { if ((error as { code?: string }).code === 'invalid_heatmap_query') throw error; throw invalid() }
}

/** Allows callers to log/cache an opaque query key without source page data. */
export function heatmapQueryFingerprint(value: HeatmapId): string { return createHash('sha256').update(encodeHeatmapId(value)).digest('hex') }
function invalid(): never { throw httpError(400, 'invalid_heatmap_query', 'Heatmap query is invalid') }
function record(raw: unknown): Record<string, unknown> { return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {} }
function text(value: unknown, max: number): string { if (typeof value !== 'string' || value.length < 1 || value.length > max || value.trim() !== value) return invalid(); return value }
function date(value: unknown): Date { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return invalid(); return new Date(value) }
function bucket(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000 || value % 200 !== 0) return invalid(); return value }
function actionValue(value: unknown): HeatmapAction { if (typeof value !== 'string' || !(HEATMAP_ACTIONS as readonly string[]).includes(value)) return invalid(); return value as HeatmapAction }
