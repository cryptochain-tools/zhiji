import { httpError } from '../../lib/http'

export interface InsightScope { tenantId: string; projectId: string }
export type InsightKind = 'trend' | 'funnel' | 'retention' | 'path'
export type InsightVisibility = 'private' | 'project'
export interface InsightDefinition { schema_version: 1; kind: InsightKind; subject_kind: 'visitor' | 'business_user'; from: string; to: string; timezone: string; [key: string]: unknown }
export interface SaveInsightInput { name: string; description: string | null; visibility: InsightVisibility; definition: InsightDefinition }
export interface UpdateInsightInput extends SaveInsightInput { expectedDefinitionVersion: number }
export interface DashboardInput { name: string; description: string | null; expectedVersion?: number }
export interface TileInput { id?: string; savedInsightId: string; position: number; width: number; height: number; titleOverride: string | null; tileVersion?: number }

const DAY = 86_400_000
const kinds = new Set<InsightKind>([ 'trend', 'funnel', 'retention', 'path' ])
const allowed = new Set([ 'schema_version', 'kind', 'subject_kind', 'from', 'to', 'timezone', 'event_names', 'granularity', 'steps', 'start_event', 'return_event', 'period', 'period_count', 'depth', 'filters' ])
export function parseInsightInput(raw: unknown): SaveInsightInput {
  const value = record(raw)
  const unknown = Object.keys(value).filter(key => ![ 'name', 'description', 'visibility', 'definition' ].includes(key))
  if (unknown.length) invalid()
  const name = text(value.name, 200)
  const description = nullableText(value.description, 2_000)
  if (value.visibility !== 'private' && value.visibility !== 'project') invalid()
  return { name, description, visibility: value.visibility, definition: parseDefinition(value.definition) }
}
export function parseInsightUpdate(raw: unknown): UpdateInsightInput {
  const value = record(raw)
  if (!positiveInt(value.expected_definition_version) || Object.keys(value).some(key => ![ 'name', 'description', 'visibility', 'definition', 'expected_definition_version' ].includes(key))) invalid()
  const { expected_definition_version: _expected, ...rest } = value
  const input = parseInsightInput(rest)
  return { ...input, expectedDefinitionVersion: value.expected_definition_version }
}
export function parseDashboardInput(raw: unknown, update = false): DashboardInput {
  const value = record(raw); const permitted = update ? [ 'name', 'description', 'expected_version' ] : [ 'name', 'description' ]
  if (Object.keys(value).some(key => !permitted.includes(key)) || (update && !positiveInt(value.expected_version))) dashboardInvalid()
  return { name: text(value.name, 200), description: nullableText(value.description, 2_000), expectedVersion: update ? value.expected_version as number : undefined }
}
export function parseTiles(raw: unknown): { expectedVersion: number; tiles: TileInput[] } {
  const value = record(raw)
  if (!positiveInt(value.expected_version) || !Array.isArray(value.tiles) || value.tiles.length > 24 || Object.keys(value).some(key => key !== 'expected_version' && key !== 'tiles')) dashboardInvalid()
  const positions = new Set<number>(); const ids = new Set<string>()
  const tiles = value.tiles.map(entry => {
    const row = record(entry)
    if (Object.keys(row).some(key => ![ 'id', 'saved_insight_id', 'position', 'width', 'height', 'title_override', 'tile_version' ].includes(key)) || !uuid(row.saved_insight_id) || !integer(row.position, 0, 23) || !integer(row.width, 1, 12) || !integer(row.height, 1, 12) || (row.id !== undefined && !uuid(row.id)) || (row.tile_version !== undefined && !positiveInt(row.tile_version))) dashboardInvalid()
    if (positions.has(row.position) || (row.id && ids.has(row.id))) dashboardInvalid(); positions.add(row.position); if (row.id) ids.add(row.id)
    return { id: row.id as string | undefined, savedInsightId: row.saved_insight_id, position: row.position, width: row.width, height: row.height, titleOverride: nullableText(row.title_override, 200), tileVersion: row.tile_version as number | undefined }
  })
  return { expectedVersion: value.expected_version, tiles }
}
export function parseDefinition(raw: unknown): InsightDefinition {
  const value = record(raw)
  if (Object.keys(value).some(key => !allowed.has(key)) || Buffer.byteLength(JSON.stringify(value)) > 32_768 || value.schema_version !== 1 || !kinds.has(value.kind as InsightKind) || (value.subject_kind !== 'visitor' && value.subject_kind !== 'business_user') || !date(value.from) || !date(value.to) || !timezone(value.timezone)) invalid()
  const from = new Date(value.from as string); const to = new Date(value.to as string)
  if (from >= to || to.getTime() - from.getTime() > 90 * DAY || to.getTime() > Date.now() + 300_000) invalid()
  const kind = value.kind as InsightKind
  if (kind === 'trend' && (!['hour', 'day'].includes(value.granularity as string) || !Array.isArray(value.event_names) || value.event_names.length > 6 || !value.event_names.every(event))) invalid()
  if (kind === 'funnel' && (!Array.isArray(value.steps) || value.steps.length < 2 || value.steps.length > 5 || !value.steps.every(event))) invalid()
  if (kind === 'retention' && (!event(value.start_event) || !event(value.return_event) || !['day', 'week', 'month'].includes(value.period as string) || !integer(value.period_count, 1, 12))) invalid()
  if (kind === 'path' && (!event(value.start_event) || !integer(value.depth, 2, 5))) invalid()
  if (value.filters !== undefined && (!Array.isArray(value.filters) || value.filters.length > 10 || !value.filters.every(filter))) invalid()
  return value as InsightDefinition
}
function filter(value: unknown): boolean { const row = record(value); return Object.keys(row).every(key => key === 'event_name' || key === 'property') && (row.event_name === undefined || event(row.event_name)) && (row.property === undefined || property(row.property)) }
function property(value: unknown): boolean { const row = record(value); return Object.keys(row).length === 3 && typeof row.key === 'string' && row.key.length >= 1 && row.key.length <= 80 && row.operator === 'eq' && ['string', 'number', 'boolean'].includes(typeof row.value) }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'invalid_insight_definition', 'Insight definition is invalid'); return value as Record<string, unknown> }
function text(value: unknown, maximum: number): string { if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > maximum) invalid(); return value }
function nullableText(value: unknown, maximum: number): string | null { if (value === undefined || value === null) return null; return text(value, maximum) }
function event(value: unknown): value is string { return typeof value === 'string' && value.length >= 1 && value.length <= 200 && value.trim() === value }
function date(value: unknown): boolean { return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value)) }
function timezone(value: unknown): boolean { return typeof value === 'string' && value.length >= 1 && value.length <= 64 && /^[A-Za-z_+\-/]+$/.test(value) }
function positiveInt(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 }
function integer(value: unknown, min: number, max: number): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max }
function uuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function invalid(): never { throw httpError(400, 'invalid_insight_definition', 'Insight definition is invalid') }
function dashboardInvalid(): never { throw httpError(400, 'invalid_dashboard', 'Dashboard is invalid') }
