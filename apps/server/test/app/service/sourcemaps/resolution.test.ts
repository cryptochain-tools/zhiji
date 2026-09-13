import assert from 'node:assert/strict'
import { DatabaseClient, QueryResult } from '../../../../app/service/database/types'
import { SourceMapResolver, framesFromStack, normalizeErrorFrame } from '../../../../app/service/sourcemaps/resolution'
import { PrivateSourceMapArtifactStore } from '../../../../app/service/sourcemaps/artifacts'

const scope = { tenantId: 'tenant', projectId: 'project' }
const mapping = JSON.stringify({ version: 3, sources: [ '../../src/main.ts' ], names: [ 'render' ], mappings: 'AAAAA' })
const artifact = { id: 'artifact', release: 'web@1', dist: 'default', artifact_path: '/assets/app.js', map_sha256: 'edbccf9858e8534d013407462a3abd1993cda6e07f1e6c8ca88619e44824b8be', artifact_ref: 'sourcemap/20000000-0000-4000-8000-000000000001.json', mapping_byte_count: Buffer.byteLength(mapping) }

describe('SourceMapResolver', () => {
  it('uses project/release/dist/path exact matching, caches safe positions, and never returns mappings', async () => {
    const database = new ResolutionDatabase(artifact)
    const resolver = new SourceMapResolver(database, new MemoryArtifacts(mapping))
    const [frame] = await resolver.resolve(scope, 'web@1', 'default', [{ filename: '/assets/app.js', line: 1, column: 0, function: 'generated' }])
    assert.deepEqual(frame, { filename: '/assets/app.js', line: 1, column: 0, function: 'generated', resolved: true,
      artifact: { release: 'web@1', dist: 'default', path: '/assets/app.js', map_sha256: 'edbccf9858e8534d013407462a3abd1993cda6e07f1e6c8ca88619e44824b8be' },
      original: { source: 'src/main.ts', line: 1, column: 0, function: 'render' } })
    assert.match(database.calls[0]!.text, /tenant_id=\$1 AND project_id=\$2 AND release=\$3 AND dist=\$4 AND artifact_path=\$5/)
    assert.equal(database.calls.some(call => call.text.includes('mapping_blob')), false)
    assert.equal(database.calls.some(call => call.text.includes('artifact_ref') && call.text.includes('source_map_artifacts')), true)
    assert.ok(database.calls.some(call => call.text.includes('INSERT INTO source_map_resolutions')))
  })

  it('leaves generated frame intact for missing release, invalid position, and missing artifact', async () => {
    const resolver = new SourceMapResolver(new ResolutionDatabase(null))
    assert.deepEqual(await resolver.resolve(scope, null, null, [{ filename: '/assets/app.js', line: 1, column: 0 }]), [{ filename: '/assets/app.js', line: 1, column: 0, resolved: false, resolution_reason: 'missing_release' }])
    assert.deepEqual(await resolver.resolve(scope, 'web@1', null, [{ filename: '/assets/app.js' }]), [{ filename: '/assets/app.js', resolved: false, resolution_reason: 'invalid_position' }])
    assert.deepEqual(await resolver.resolve(scope, 'web@1', null, [{ filename: '/assets/app.js', line: 1, column: 0 }]), [{ filename: '/assets/app.js', line: 1, column: 0, resolved: false, resolution_reason: 'missing_artifact' }])
  })

  it('normalizes only safe generated frames and stack fallbacks', () => {
    assert.equal(normalizeErrorFrame({ filename: 'https://host/assets/app.js', line: 1, column: 0 }), null)
    assert.deepEqual(framesFromStack('Error\n at render (https://site.test/assets/app.js:12:3)'), [{ filename: '/assets/app.js', function: 'render', line: 12, column: 3, in_app: true }])
  })
})

class MemoryArtifacts implements PrivateSourceMapArtifactStore {
  private readonly contents: string
  constructor(contents: string) { this.contents = contents }
  async put(): Promise<{ ref: string; byteCount: number }> { throw new Error('not used') }
  async read(): Promise<Buffer | null> { return Buffer.from(this.contents) }
  async remove(): Promise<void> {}
}

class ResolutionDatabase implements DatabaseClient {
  readonly calls: Array<{ text: string; values?: readonly unknown[] }> = []
  private readonly active: typeof artifact | null
  constructor(active: typeof artifact | null) { this.active = active }
  async query<Row extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
    this.calls.push({ text, values })
    if (text.includes('FROM source_map_artifacts')) return { rows: this.active ? [this.active as Row] : [], rowCount: this.active ? 1 : 0 }
    if (text.includes('FROM source_map_resolutions')) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 1 }
  }
}
