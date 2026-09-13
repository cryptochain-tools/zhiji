import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  SourceMapArtifact,
  SourceMapDependencies,
  SourceMapUploadRequest,
} from '../../../../app/contracts/sourcemaps'
import { SourceMapContractError, uploadSourceMap } from '../../../../app/service/sourcemaps'

const validMap = JSON.stringify({ version: 3, sources: [ 'src/main.ts' ], names: [], mappings: 'AAAA' })
const validKey = 'source-map-upload-key-1234'
const fixedNow = new Date('2026-09-12T00:00:00.000Z')

function request(overrides: Partial<SourceMapUploadRequest> = {}): SourceMapUploadRequest {
  return { key: validKey, release: 'web@1.2.3', dist: 'default', artifact_path: '/assets/main.js', map: validMap, ...overrides }
}

function dependencies(write: (artifact: SourceMapArtifact) => Promise<'created' | 'idempotent' | 'conflict'> = async () => 'created'): SourceMapDependencies {
  return {
    keys: { authenticate: async key => key === validKey ? { keyId: 'key_1', tenantId: 'tenant_1', projectId: 'project_1', disabled: false } : null },
    artifacts: { putIfAbsent: async artifact => {
      const status = await write(artifact)
      return status === 'conflict' ? { status } : { status, artifact }
    } },
    now: () => fixedNow,
    createId: () => 'map_1',
  }
}

describe('Source Map upload contract', () => {
  it('stores only a validated private mapping blob and returns safe metadata', async () => {
    let stored: SourceMapArtifact | undefined
    const result = await uploadSourceMap(request(), dependencies(async artifact => { stored = artifact; return 'created' }))
    assert.deepEqual(result, { artifact: { id: 'map_1', release: 'web@1.2.3', dist: 'default', artifact_path: '/assets/main.js', map_sha256: createHash('sha256').update(validMap).digest('hex'), source_count: 1, created_at: fixedNow.toISOString() } })
    assert.equal(stored?.tenantId, 'tenant_1')
    assert.equal(stored?.mappingBlob, validMap)
    assert.equal('sourcesContent' in JSON.parse(stored?.mappingBlob ?? '{}'), false)
  })

  it('rejects unauthorized and disabled upload keys before storage', async () => {
    await assert.rejects(() => uploadSourceMap(request({ key: 'not-a-real-upload-key-123' }), dependencies()), isCode('invalid_sourcemap_key', 401))
    await assert.rejects(() => uploadSourceMap(request()), isCode('invalid_sourcemap_key', 401))
    const disabled = dependencies()
    disabled.keys.authenticate = async () => ({ keyId: 'key_1', tenantId: 'tenant_1', projectId: 'project_1', disabled: true })
    await assert.rejects(() => uploadSourceMap(request(), disabled), isCode('sourcemap_key_disabled', 403))
  })

  it('rejects unsafe maps, oversized maps, checksums, and artifact paths', async () => {
    await assert.rejects(() => uploadSourceMap(request({ map: JSON.stringify({ version: 3, sources: [ 'src/a.ts' ], sourcesContent: [ 'secret' ], names: [], mappings: 'AAAA' }) }), dependencies()), isCode('invalid_sourcemap', 422))
    await assert.rejects(() => uploadSourceMap(request({ map: JSON.stringify({ version: 3, sources: [ '/private/a.ts' ], names: [], mappings: 'AAAA' }) }), dependencies()), isCode('invalid_sourcemap', 422))
    await assert.rejects(() => uploadSourceMap(request({ map: 'x'.repeat(5 * 1024 * 1024 + 1) }), dependencies()), isCode('sourcemap_too_large', 413))
    await assert.rejects(() => uploadSourceMap(request({ artifact_path: '/assets/../main.js' }), dependencies()), isCode('invalid_sourcemap', 422))
    await assert.rejects(() => uploadSourceMap(request({ map_sha256: '0'.repeat(64) }), dependencies()), isCode('invalid_sourcemap', 422))
  })

  it('allows a replacement only through the CI upload-key compare-and-swap contract', async () => {
    let seen: { expected: string; keyId: string; map: string } | undefined
    const deps = dependencies()
    deps.artifacts.supersede = async (artifact, expected) => {
      seen = { expected, keyId: artifact.createdByKeyId, map: artifact.mappingBlob }
      return { status: 'created', artifact }
    }
    const expected = 'a'.repeat(64)
    const result = await uploadSourceMap(request({ supersede: { expected_map_sha256: expected } }), deps)
    assert.equal(result.artifact.id, 'map_1')
    assert.deepEqual(seen, { expected, keyId: 'key_1', map: validMap })
    await assert.rejects(() => uploadSourceMap(request({ supersede: { expected_map_sha256: 'bad' } }), deps), isCode('invalid_sourcemap_supersede', 422))
  })

  it('is idempotent only when the restricted store confirms the same artifact and surfaces conflicts', async () => {
    const idempotent = await uploadSourceMap(request(), dependencies(async () => 'idempotent'))
    assert.equal(idempotent.artifact.id, 'map_1')
    await assert.rejects(() => uploadSourceMap(request(), dependencies(async () => 'conflict')), isCode('sourcemap_artifact_conflict', 409))
  })
})

function isCode(code: string, status: number) {
  return (error: unknown) => error instanceof SourceMapContractError && error.code === code && error.status === status
}
