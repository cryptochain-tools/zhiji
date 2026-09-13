import { createHash } from 'node:crypto'
import { httpError } from '../../lib/http'

export interface CohortScope { tenantId: string; projectId: string }
export type SubjectKind = 'visitor' | 'business_user'
export type Visibility = 'private' | 'project'
export interface PropertyFilter { key: string; value: string | number | boolean }
export interface CohortDefinition { schema_version: 1; event_name: string; min_occurrences: number; max_occurrences?: number; window: { kind: 'absolute'; from: string; to: string } | { kind: 'relative'; days: number }; property_filters?: PropertyFilter[] }
export interface CohortInput { name: string; description: string | null; visibility: Visibility; subjectKind: SubjectKind; definition: CohortDefinition }
export interface CohortUpdateInput extends CohortInput { expectedDefinitionVersion: number }
export interface PreviewInput { asOf: Date }
const DAY = 86_400_000
const MAX_WINDOW_DAYS = 90

export function parseCohortInput(raw: unknown): CohortInput {
  const value = object(raw, 'invalid_cohort')
  if (Object.keys(value).some(key => ![ 'name', 'description', 'visibility', 'subject_kind', 'definition' ].includes(key))) invalid()
  const visibility = value.visibility
  if (visibility !== 'private' && visibility !== 'project') invalid()
  if (value.subject_kind !== 'visitor' && value.subject_kind !== 'business_user') invalid()
  return { name: text(value.name, 200), description: nullableText(value.description, 2000), visibility, subjectKind: value.subject_kind, definition: parseDefinition(value.definition) }
}
export function parseCohortUpdate(raw: unknown): CohortUpdateInput {
  const value = object(raw, 'invalid_cohort')
  if (!positive(value.expected_definition_version) || Object.keys(value).some(key => ![ 'name', 'description', 'visibility', 'subject_kind', 'definition', 'expected_definition_version' ].includes(key))) invalid()
  const { expected_definition_version: expectedDefinitionVersion, ...rest } = value
  return { ...parseCohortInput(rest), expectedDefinitionVersion: expectedDefinitionVersion }
}
export function parsePreview(raw: unknown, now = new Date()): PreviewInput {
  if (raw === undefined || raw === null) return { asOf: now }
  const value = object(raw, 'invalid_cohort_preview')
  if (Object.keys(value).some(key => key !== 'as_of')) previewInvalid()
  if (value.as_of === undefined) return { asOf: now }
  if (typeof value.as_of !== 'string' || value.as_of.length > 64 || !Number.isFinite(Date.parse(value.as_of))) previewInvalid()
  const asOf = new Date(value.as_of)
  if (asOf.getTime() > now.getTime() + 300_000 || asOf.getTime() < now.getTime() - (MAX_WINDOW_DAYS + 1) * DAY) previewInvalid()
  return { asOf }
}
export function snapshotRange(definition: CohortDefinition, asOf: Date): { from: Date; to: Date } {
  if (definition.window.kind === 'absolute') return { from: new Date(definition.window.from), to: new Date(definition.window.to) }
  return { from: new Date(asOf.getTime() - definition.window.days * DAY), to: asOf }
}
export function queryHash(subjectKind: SubjectKind, definition: CohortDefinition, range: { from: Date; to: Date }): Buffer {
  return createHash('sha256').update(JSON.stringify({ subject_kind: subjectKind, definition, range_from: range.from.toISOString(), range_to: range.to.toISOString() })).digest()
}
function parseDefinition(raw: unknown): CohortDefinition {
  const value = object(raw, 'invalid_cohort_definition')
  if (Object.keys(value).some(key => ![ 'schema_version', 'event_name', 'min_occurrences', 'max_occurrences', 'window', 'property_filters' ].includes(key)) || value.schema_version !== 1 || !event(value.event_name) || !integer(value.min_occurrences, 1, 10000)) invalid()
  if (value.max_occurrences !== undefined && (!integer(value.max_occurrences, 1, 10000) || value.max_occurrences < value.min_occurrences)) invalid()
  const window = parseWindow(value.window)
  let propertyFilters: PropertyFilter[] | undefined
  if (value.property_filters !== undefined) {
    if (!Array.isArray(value.property_filters) || value.property_filters.length > 5) invalid()
    const keys = new Set<string>(); propertyFilters = value.property_filters.map(rawFilter => {
      const filter = object(rawFilter, 'invalid_cohort_definition')
      if (Object.keys(filter).some(key => key !== 'key' && key !== 'value') || typeof filter.key !== 'string' || filter.key.trim() !== filter.key || filter.key.length < 1 || filter.key.length > 80 || ![ 'string', 'number', 'boolean' ].includes(typeof filter.value) || keys.has(filter.key)) invalid()
      keys.add(filter.key); return { key: filter.key, value: filter.value as string | number | boolean }
    })
  }
  return { schema_version: 1, event_name: value.event_name, min_occurrences: value.min_occurrences, ...(value.max_occurrences === undefined ? {} : { max_occurrences: value.max_occurrences }), window, ...(propertyFilters?.length ? { property_filters: propertyFilters } : {}) }
}
function parseWindow(raw: unknown): CohortDefinition['window'] {
  const value = object(raw, 'invalid_cohort_definition')
  if (value.kind === 'relative' && Object.keys(value).every(key => key === 'kind' || key === 'days') && integer(value.days, 1, MAX_WINDOW_DAYS)) return { kind: 'relative', days: value.days }
  if (value.kind === 'absolute' && Object.keys(value).every(key => key === 'kind' || key === 'from' || key === 'to') && date(value.from) && date(value.to)) {
    const from = new Date(value.from); const to = new Date(value.to)
    if (from < to && to.getTime() - from.getTime() <= MAX_WINDOW_DAYS * DAY && to.getTime() <= Date.now() + 300_000) return { kind: 'absolute', from: from.toISOString(), to: to.toISOString() }
  }
  invalid()
}
function object(value: unknown, code: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, code, 'Cohort input is invalid'); return value as Record<string, unknown> }
function text(value: unknown, max: number): string { if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > max) invalid(); return value }
function nullableText(value: unknown, max: number): string | null { return value === null || value === undefined ? null : text(value, max) }
function event(value: unknown): value is string { return typeof value === 'string' && value.trim() === value && value.length >= 1 && value.length <= 200 }
function date(value: unknown): value is string { return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value)) }
function positive(value: unknown): value is number { return integer(value, 1, Number.MAX_SAFE_INTEGER) }
function integer(value: unknown, min: number, max: number): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max }
function invalid(): never { throw httpError(400, 'invalid_cohort', 'Cohort is invalid') }
function previewInvalid(): never { throw httpError(400, 'invalid_cohort_preview', 'Cohort preview is invalid') }
