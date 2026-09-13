import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { SourceMapManagementService } from '../../../../app/service/sourcemapManagement'
import { SourceMapManagementRepository } from '../../../../app/service/sourcemapManagement/repository'
import { DatabasePool, DatabaseTransaction, QueryResult } from '../../../../app/service/database/types'
import { PrivateSourceMapArtifactStore } from '../../../../app/service/sourcemaps/artifacts'

const scope = { tenantId: '20000000-0000-4000-8000-000000000001', projectId: '20000000-0000-4000-8000-000000000002' }
const actor = '20000000-0000-4000-8000-000000000003'
const artifact = '20000000-0000-4000-8000-000000000004'
const currentHash = 'a'.repeat(64)
const map = JSON.stringify({ version: 3, sources: [ 'src/app.ts' ], names: [], mappings: 'AAAA' })

class Database implements DatabasePool {
  calls: Array<{ text: string; values?: readonly unknown[] }> = []
  async query<Row extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> { this.calls.push({ text, values }); return { rows: [], rowCount: 0 } }
  async transaction<T>(run: (tx: DatabaseTransaction) => Promise<T>): Promise<T> { return run({ query: this.query.bind(this), commit: async () => {}, rollback: async () => {} }) }
}

describe('SourceMapManagementService', () => {
  it('returns only safe metadata', async () => {
    const database = new Database()
    database.query = async <Row extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      database.calls.push({ text, values })
      return { rows: [{ id: artifact, release: 'r1', dist: 'default', artifact_path: '/assets/a.js', map_sha256: currentHash, format_version: 3, source_count: 1, created_at: new Date('2026-01-01T00:00:00.000Z'), superseded_at: null } as Row], rowCount: 1 }
    }
    const result = await new SourceMapManagementService(new SourceMapManagementRepository(database, new MemoryArtifacts())).list(scope)
    assert.deepEqual(Object.keys(result.items[0]!).sort(), [ 'artifact_path', 'created_at', 'dist', 'format_version', 'id', 'map_sha256', 'release', 'source_count', 'superseded_at' ])
    assert.doesNotMatch(database.calls[0]?.text ?? '', /mapping_blob/)
  })

  it('validates map content and atomically retires then replaces with audit evidence', async () => {
    const database = new Database()
    let step = 0
    database.query = async <Row extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
      database.calls.push({ text, values }); step += 1
      if (step === 1) return { rows: [{ id: artifact, release: 'r1', dist: 'default', artifact_path: '/assets/a.js', map_sha256: currentHash } as Row], rowCount: 1 }
      if (step === 2) return { rows: [], rowCount: 1 }
      if (step === 3) return { rows: [{ id: '20000000-0000-4000-8000-000000000005', release: 'r1', dist: 'default', artifact_path: '/assets/a.js', map_sha256: 'b'.repeat(64), format_version: 3, source_count: 1, created_at: new Date(), superseded_at: null } as Row], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    }
    const service = new SourceMapManagementService(new SourceMapManagementRepository(database, new MemoryArtifacts()), () => new Date('2026-01-01T00:00:00.000Z'))
    const result = await service.supersede(scope, actor, artifact, { expected_map_sha256: currentHash, map })
    assert.equal(result.artifact.artifact_path, '/assets/a.js')
    assert.equal(database.calls.length, 4)
    assert.match(database.calls[0]?.text ?? '', /FOR UPDATE/)
    assert.match(database.calls[1]?.text ?? '', /superseded_at/)
    assert.match(database.calls[2]?.text ?? '', /artifact_ref/)
    assert.doesNotMatch(database.calls[2]?.text ?? '', /mapping_blob/)
    assert.match(database.calls[3]?.text ?? '', /sourcemap_artifact_superseded/)
    assert.doesNotMatch(JSON.stringify(database.calls[3]?.values), /src\/app/)
  })

  it('rejects a stale hash before any repository write', async () => {
    const database = new Database()
    const service = new SourceMapManagementService(new SourceMapManagementRepository(database, new MemoryArtifacts()))
    await assert.rejects(() => service.supersede(scope, actor, artifact, { expected_map_sha256: 'bad', map }), { code: 'invalid_sourcemap_supersede' })
    assert.equal(database.calls.length, 0)
  })
})

class MemoryArtifacts implements PrivateSourceMapArtifactStore {
  async put(): Promise<{ ref: string; byteCount: number }> { return { ref: 'sourcemap/20000000-0000-4000-8000-000000000005.json', byteCount: Buffer.byteLength(map) } }
  async read(): Promise<Buffer | null> { return null }
  async remove(): Promise<void> {}
}
