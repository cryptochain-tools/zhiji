import { httpError } from '../../lib/http'

export interface UserJourneyScope { tenantId: string; projectId: string }

export interface UserJourneyQuery extends UserJourneyScope {
  businessUserId: string
  from: Date
  to: Date
  limit: number
}

export function parseUserJourneyQuery(scope: UserJourneyScope, businessUserIdValue: unknown, raw: unknown, now = new Date()): UserJourneyQuery {
  const businessUserId = bounded(businessUserIdValue, 128, 1)
  if (!businessUserId || !object(raw)) invalid()
  const limit = queryInteger(raw.limit ?? '100', 1, 200)
  const to = raw.to === undefined ? now : date(raw.to) ? new Date(raw.to) : null
  const from = raw.from === undefined
    ? to && new Date(to.getTime() - 30 * 24 * 60 * 60_000)
    : date(raw.from) ? new Date(raw.from) : null
  if (limit === null || !from || !to || !(from < to) || to.getTime() > now.getTime() + 5 * 60_000 || to.getTime() - from.getTime() > 90 * 24 * 60 * 60_000) invalid()
  return { ...scope, businessUserId, from, to, limit }
}

export function parseUserDirectoryQuery(scope: UserJourneyScope, raw: unknown): UserJourneyScope & { search: string; limit: number } {
  if (!object(raw)) invalidDirectory()
  const search = raw.search === undefined ? '' : bounded(raw.search, 200)
  const limit = queryInteger(raw.limit ?? '50', 1, 100)
  if (search === null || limit === null) invalidDirectory()
  return { ...scope, search, limit }
}

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function date(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) }
function bounded(value: unknown, maximum: number, minimum = 0): string | null { return typeof value === 'string' && value.trim() === value && value.length >= minimum && value.length <= maximum ? value : null }
function queryInteger(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}
function invalid(): never { throw httpError(400, 'invalid_user_journey_query', 'User journey query is invalid') }
function invalidDirectory(): never { throw httpError(400, 'invalid_user_directory_query', 'User directory query is invalid') }
