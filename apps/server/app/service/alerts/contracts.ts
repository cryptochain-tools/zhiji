import { httpError } from '../../lib/http'

export const ALERT_RULE_TYPES = [ 'error_new', 'error_regression', 'error_count', 'performance_p75', 'performance_rating' ] as const
export type AlertRuleType = typeof ALERT_RULE_TYPES[number]
export const NOTIFICATION_TYPES = [ 'lark_bot', 'email', 'webhook' ] as const
export type NotificationType = typeof NOTIFICATION_TYPES[number]
export interface AlertScope { tenantId: string; projectId: string }
export interface AlertListCursor { createdAt: Date; id: string }
export interface AlertListQuery { cursor?: AlertListCursor; limit: number }
export interface SafeAlertSummary { count?: number; window_seconds?: number; metric?: string; sample_count?: number; poor_ratio?: number; release?: string }
export interface AlertRuleInput { name: string; ruleType: AlertRuleType; condition: Record<string, unknown>; targetIds: string[]; enabled: boolean }
export interface AlertRulePatch { expectedUpdatedAt: Date; name?: string; condition?: Record<string, unknown>; targetIds?: string[]; enabled?: boolean }
export interface AlertTargetPatch { expectedUpdatedAt: Date; label?: string; enabled?: boolean }

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseAlertListQuery(raw: unknown): AlertListQuery {
  const value = object(raw); let limit = DEFAULT_PAGE_SIZE
  if (value.limit !== undefined) { const parsed = typeof value.limit === 'string' && /^\d+$/.test(value.limit) ? Number(value.limit) : Number.NaN; if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) throw httpError(400, 'invalid_alert_query', 'Alert page limit is invalid'); limit = parsed }
  if (value.cursor === undefined) return { limit }
  if (typeof value.cursor !== 'string' || value.cursor.length > 300) throw invalidCursor()
  try { const decoded: unknown = JSON.parse(Buffer.from(value.cursor, 'base64url').toString('utf8')); if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('invalid'); const cursor = decoded as { created_at?: unknown; id?: unknown }; if (typeof cursor.created_at !== 'string' || !Number.isFinite(Date.parse(cursor.created_at)) || typeof cursor.id !== 'string' || !UUID.test(cursor.id)) throw new Error('invalid'); return { limit, cursor: { createdAt: new Date(cursor.created_at), id: cursor.id } } } catch { throw invalidCursor() }
}
export function alertCursorFor(createdAt: Date, id: string): string { return Buffer.from(JSON.stringify({ created_at: createdAt.toISOString(), id }), 'utf8').toString('base64url') }

export function parseRuleInput(raw: unknown): AlertRuleInput {
  const value = object(raw); only(value, [ 'name', 'rule_type', 'condition', 'target_ids', 'enabled' ])
  const ruleType = ruleTypeOf(value.rule_type); const condition = object(value.condition); const targetIds = targetIdsOf(value.target_ids)
  validateCondition(ruleType, condition)
  return { name: boundedText(value.name, 1, 200, 'invalid_alert_rule'), ruleType, condition, targetIds, enabled: value.enabled === undefined ? true : boolean(value.enabled, 'invalid_alert_rule') }
}
export function parseRulePatch(raw: unknown, now = new Date()): AlertRulePatch {
  const value = object(raw); only(value, [ 'expected_updated_at', 'name', 'condition', 'target_ids', 'enabled' ])
  const patch: AlertRulePatch = { expectedUpdatedAt: expectedTimestamp(value.expected_updated_at, now) }
  if ('name' in value) patch.name = boundedText(value.name, 1, 200, 'invalid_alert_rule')
  if ('condition' in value) patch.condition = object(value.condition)
  if ('target_ids' in value) patch.targetIds = targetIdsOf(value.target_ids)
  if ('enabled' in value) patch.enabled = boolean(value.enabled, 'invalid_alert_rule')
  if (Object.keys(patch).length === 1) throw httpError(400, 'invalid_alert_rule', 'No alert rule changes were supplied')
  return patch
}
export function parseTargetPatch(raw: unknown, now = new Date()): AlertTargetPatch {
  const value = object(raw); only(value, [ 'expected_updated_at', 'label', 'enabled' ])
  const patch: AlertTargetPatch = { expectedUpdatedAt: expectedTimestamp(value.expected_updated_at, now) }
  if ('label' in value) patch.label = boundedText(value.label, 1, 200, 'invalid_notification_target')
  if ('enabled' in value) patch.enabled = boolean(value.enabled, 'invalid_notification_target')
  if (Object.keys(patch).length === 1) throw httpError(400, 'invalid_notification_target', 'No notification target changes were supplied')
  return patch
}
export function parseExpectedUpdatedAt(raw: unknown, now = new Date()): Date { const value = object(raw); only(value, [ 'expected_updated_at' ]); return expectedTimestamp(value.expected_updated_at, now) }

export function scrubAlertSummary(raw: unknown): SafeAlertSummary { const value = object(raw); const result: SafeAlertSummary = {}; for (const key of [ 'count', 'window_seconds', 'sample_count' ] as const) if (typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key]; if (typeof value.poor_ratio === 'number' && Number.isFinite(value.poor_ratio) && value.poor_ratio >= 0 && value.poor_ratio <= 1) result.poor_ratio = value.poor_ratio; if (typeof value.metric === 'string' && /^[A-Z]{2,10}$/.test(value.metric)) result.metric = value.metric; if (typeof value.release === 'string' && value.release.length > 0 && value.release.length <= 200) result.release = value.release; return result }
export function parseTargetInput(raw: unknown): { type: NotificationType; label: string; configPublic: Record<string, never> } { const value = object(raw); only(value, [ 'type', 'label' ]); if (!NOTIFICATION_TYPES.includes(value.type as NotificationType)) throw httpError(400, 'invalid_notification_target', 'Notification target type is invalid'); return { type: value.type as NotificationType, label: boundedText(value.label, 1, 200, 'invalid_notification_target'), configPublic: {} } }

export function validateCondition(type: AlertRuleType, condition: Record<string, unknown>): void { const window = condition.window_seconds; if (type === 'error_new' || type === 'error_regression') { if (Object.keys(condition).length !== 0) throw httpError(400, 'invalid_alert_rule', 'Alert condition is invalid'); return }; const allowed = type.startsWith('performance_') ? [ 'window_seconds', 'threshold', 'minimum_samples', 'metric' ] : [ 'window_seconds', 'threshold' ]; if (Object.keys(condition).some(key => !allowed.includes(key))) throw httpError(400, 'invalid_alert_rule', 'Alert condition is invalid'); if ((window !== 300 && window !== 900 && window !== 3600 && window !== 86400) || typeof condition.threshold !== 'number' || !Number.isFinite(condition.threshold) || condition.threshold <= 0) throw httpError(400, 'invalid_alert_rule', 'Alert condition is invalid'); if (type.startsWith('performance_') && (!Number.isSafeInteger(condition.minimum_samples) || (condition.minimum_samples as number) < 1 || (condition.minimum_samples as number) > 1_000_000)) throw httpError(400, 'invalid_alert_rule', 'Alert minimum samples is invalid'); if ('metric' in condition && (typeof condition.metric !== 'string' || ![ 'CLS', 'INP', 'LCP', 'FCP', 'TTFB' ].includes(condition.metric))) throw httpError(400, 'invalid_alert_rule', 'Alert metric is invalid') }
function targetIdsOf(value: unknown): string[] { const ids = Array.isArray(value) ? value : []; if (ids.length < 1 || ids.length > 20 || ids.some(id => typeof id !== 'string' || !UUID.test(id))) throw httpError(400, 'invalid_alert_rule', 'Alert rule target list is invalid'); return [ ...new Set(ids) ] }
function ruleTypeOf(value: unknown): AlertRuleType { if (!ALERT_RULE_TYPES.includes(value as AlertRuleType)) throw httpError(400, 'invalid_alert_rule', 'Alert rule type is invalid'); return value as AlertRuleType }
function expectedTimestamp(value: unknown, now: Date): Date { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw httpError(400, 'invalid_alert_update', 'expected_updated_at is invalid'); const date = new Date(value); if (date.getTime() > now.getTime() + 300_000) throw httpError(400, 'invalid_alert_update', 'expected_updated_at is invalid'); return date }
function object(raw: unknown): Record<string, unknown> { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, 'invalid_alert_input', 'Alert input is invalid'); return raw as Record<string, unknown> }
function only(value: Record<string, unknown>, fields: readonly string[]) { if (Object.keys(value).some(key => !fields.includes(key))) throw httpError(400, 'invalid_alert_input', 'Alert input is invalid') }
function boundedText(value: unknown, min: number, max: number, code: string): string { if (typeof value !== 'string' || value.length < min || value.length > max || value.trim() !== value) throw httpError(400, code, 'Alert input is invalid'); return value }
function boolean(value: unknown, code: string): boolean { if (typeof value !== 'boolean') throw httpError(400, code, 'Alert input is invalid'); return value }
function invalidCursor(): never { throw httpError(400, 'invalid_alert_cursor', 'Alert page cursor is invalid') }
