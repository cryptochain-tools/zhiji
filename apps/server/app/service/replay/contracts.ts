import { httpError } from '../../lib/http'

export interface ReplayScope { tenantId: string; projectId: string }
export interface ReplayListQuery { from: Date; to: Date; route?: string; release?: string; visitorId?: string; limit: number; cursor?: { startedAt: Date; id: string } }

export function parseReplayListQuery(value: unknown, now = new Date()): ReplayListQuery {
  const raw = record(value)
  const to = date(raw.to) ?? now
  const from = date(raw.from) ?? new Date(to.getTime() - 24 * 60 * 60 * 1000)
  if (from > to || to.getTime() - from.getTime() > 7 * 24 * 60 * 60 * 1000 || from < new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)) throw httpError(400, 'invalid_replay_query', 'Replay query range is invalid')
  const route = optionalRoute(raw.route)
  const release = optionalText(raw.release, 200)
  const visitorId = optionalText(raw.visitor_id, 128)
  const limit = integer(raw.limit, 50, 1, 100)
  const cursor = cursorValue(raw.cursor)
  return { from, to, ...(route && { route }), ...(release && { release }), ...(visitorId && { visitorId }), limit, ...(cursor && { cursor }) }
}

export function parseReplayChunkQuery(value: unknown, now = new Date()): { from?: Date; to?: Date } {
  const raw = record(value); const from = raw.from === undefined ? undefined : date(raw.from); const to = raw.to === undefined ? undefined : date(raw.to)
  if ((raw.from !== undefined && !from) || (raw.to !== undefined && !to) || (from && to && (from > to || to.getTime() - from.getTime() > 7 * 86400000)) || (from && from < new Date(now.getTime() - 7 * 86400000))) throw httpError(400, 'invalid_replay_query', 'Replay query range is invalid')
  return { ...(from && { from }), ...(to && { to }) }
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function date(value: unknown): Date | undefined { if (typeof value !== 'string' || value.length > 64) return undefined; const ms = Date.parse(value); return Number.isFinite(ms) ? new Date(ms) : undefined }
function optionalText(value: unknown, length: number): string | undefined { return typeof value === 'string' && value.length > 0 && value.length <= length && value.trim() === value ? value : undefined }
function optionalRoute(value: unknown): string | undefined { const route = optionalText(value, 512); return route && route.startsWith('/') && !/[?#@]/.test(route) ? route : undefined }
function integer(value: unknown, fallback: number, min: number, max: number): number { return typeof value === 'string' && /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback }
function cursorValue(value: unknown): { startedAt: Date; id: string } | undefined { if (typeof value !== 'string') return undefined; const match = /^(\d{13})\.([0-9a-f-]{36})$/i.exec(value); if (!match) throw httpError(400, 'invalid_replay_query', 'Replay cursor is invalid'); const startedAt = new Date(Number(match[1])); return Number.isFinite(startedAt.getTime()) ? { startedAt, id: match[2]! } : undefined }
