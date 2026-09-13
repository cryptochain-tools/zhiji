import { deflateRawSync } from 'node:zlib'
import { AnalyticsRepository } from '../analytics/repository'
import { parseTrendQuery } from '../analytics/contracts'
import { FunnelRepository } from '../funnel/repository'
import { parseFunnelQuery } from '../funnel/contracts'
import { AdvancedAnalyticsRepository } from '../advancedAnalytics/repository'
import { parsePathQuery, parseRetentionQuery } from '../advancedAnalytics/contracts'
import { InsightDefinition } from '../insights/contracts'
import type { DashboardExportPlan } from './index'
import { DatabaseClient } from '../database/types'
import { escapeCsvCell, ExportFormat, ReportingScope } from './contracts'

export interface ExportTable { name: string; rows: string[][] }
const MAX_ROWS = 100_000
const MAX_BYTES = 50 * 1024 * 1024

/** Executes only parser-validated aggregate definitions; it has no raw-data path. */
export async function renderAggregateExport(database: DatabaseClient, scope: ReportingScope, definition: InsightDefinition | DashboardExportPlan, format: ExportFormat, now = new Date()): Promise<{ contents: Buffer; rowCount: number }> {
  const tables = isDashboardPlan(definition) ? await Promise.all(definition.definitions.map(async item => ({ ...(await tablesFor(database, scope, item.definition, now))[0]!, name: item.name }))) : await tablesFor(database, scope, definition, now)
  const count = tables.reduce((sum, table) => sum + Math.max(0, table.rows.length - 1), 0)
  if (count > MAX_ROWS) throw new Error('export_limit_exceeded')
  const contents = format === 'csv' ? csv(tables) : xlsx(tables)
  if (contents.length > MAX_BYTES) throw new Error('export_limit_exceeded')
  return { contents, rowCount: count }
}

async function tablesFor(database: DatabaseClient, scope: ReportingScope, definition: InsightDefinition, now: Date): Promise<ExportTable[]> {
  if (definition.kind === 'trend') {
    const query = parseTrendQuery(scope, definition, now); if (!query) throw new Error('invalid_export_definition')
    const points = await new AnalyticsRepository(database).trend(query)
    return [{ name: 'trend', rows: [[ 'bucket_start', 'event_name', 'event_count', 'page_views', 'visitors' ], ...points.map(point => [ point.bucket_start.toISOString(), point.event_name, String(point.event_count), String(point.page_views), String(point.visitors) ])] }]
  }
  if (definition.kind === 'funnel') {
    const query = parseFunnelQuery(scope, definition, now)
    const result = await new FunnelRepository(database).counts(query)
    return [{ name: 'funnel', rows: [[ 'step', 'count' ], ...result.steps.map(row => [ row.name, String(row.count) ])] }]
  }
  if (definition.kind === 'retention') {
    const query = parseRetentionQuery(scope, definition, now); const result = await new AdvancedAnalyticsRepository(database).retention(query)
    const head = [ 'cohort_start', 'cohort_size', ...Array.from({ length: query.periodCount }, (_, index) => `retained_${index + 1}`) ]
    return [{ name: 'retention', rows: [ head, ...result.rows.map(row => [ row.cohortBucket.toISOString(), String(row.cohortSize), ...row.retained.map(String) ]) ] }]
  }
  if (definition.kind === 'path') {
    const query = parsePathQuery(scope, definition, now); const result = await new AdvancedAnalyticsRepository(database).path(query)
    return [{ name: 'path', rows: [[ 'depth', 'parent_path', 'name', 'subject_count' ], ...result.rows.map(row => [ String(row.depth), row.parentPath.join(' > '), row.name, String(row.count) ])] }]
  }
  throw new Error('invalid_export_definition')
}

function isDashboardPlan(value: InsightDefinition | DashboardExportPlan): value is DashboardExportPlan { return 'export_plan' in value && value.export_plan === 'dashboard' }

function csv(tables: ExportTable[]): Buffer {
  // CSV has one table. Definitions are single aggregate results; XLSX supports multi-sheet separately.
  const table = tables[0]!
  return Buffer.from(table.rows.map(row => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n', 'utf8')
}

function xlsx(tables: ExportTable[]): Buffer {
  const entries: Array<[string, Buffer]> = [
    [ '[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${tables.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) ],
    [ '_rels/.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) ],
    [ 'xl/workbook.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tables.map((table, index) => `<sheet name="${xml(sheetName(table.name, index))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`) ],
    [ 'xl/_rels/workbook.xml.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`) ],
  ]
  for (const [index, table] of tables.entries()) entries.push([ `xl/worksheets/sheet${index + 1}.xml`, Buffer.from(sheet(table.rows)) ])
  return zip(entries)
}
function sheet(rows: string[][]): string { return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${cell(c, r)}" t="inlineStr"><is><t>${xml(escaped(value))}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>` }
function escaped(value: string): string { return /^[=+\-@]/.test(value) ? `'${value}` : value }
function cell(column: number, row: number): string { let value = ''; for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) value = String.fromCharCode(65 + (n - 1) % 26) + value; return `${value}${row + 1}` }
function sheetName(name: string, index: number): string { return `${name.replace(/[\\/*?:\[\]]/g, '_').slice(0, 24) || 'Sheet'}${index ? `_${index + 1}` : ''}` }
function xml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;') }
function zip(entries: Array<[string, Buffer]>): Buffer {
  const parts: Buffer[] = []; const central: Buffer[] = []; let offset = 0
  for (const [name, data] of entries) { const filename = Buffer.from(name); const compressed = deflateRawSync(data); const crc = crc32(data); const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26); parts.push(local, filename, compressed); const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0, 8); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42); central.push(directory, filename); offset += local.length + filename.length + compressed.length }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([ ...parts, ...central, end ])
}
function crc32(data: Buffer): number { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) } return (crc ^ 0xffffffff) >>> 0 }
