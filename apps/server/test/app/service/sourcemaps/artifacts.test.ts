import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'mocha'
import { LocalPrivateSourceMapArtifactStore } from '../../../../app/service/sourcemaps/artifacts'

describe('LocalPrivateSourceMapArtifactStore', () => {
  it('uses an opaque ref, private local file, and never accepts a path as a ref', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhiji-sourcemap-'))
    try {
      const store = new LocalPrivateSourceMapArtifactStore(root)
      const result = await store.put({ artifactId: '20000000-0000-4000-8000-000000000001', contents: Buffer.from('{"version":3}') })
      assert.equal(result.ref, 'sourcemap/20000000-0000-4000-8000-000000000001.json')
      assert.equal(result.byteCount, 13)
      assert.deepEqual(await store.read(result.ref), Buffer.from('{"version":3}'))
      await assert.rejects(() => store.read('../private.map'), /invalid_sourcemap_artifact_ref/)
      await store.remove(result.ref)
      assert.equal(await store.read(result.ref), null)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
