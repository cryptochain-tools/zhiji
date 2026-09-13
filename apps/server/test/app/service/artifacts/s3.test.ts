import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import { S3CompatibleObjectStore, s3ArtifactObjectStoreFromEnvironment } from '../../../../app/service/artifacts/s3'
import { S3PrivateReplayArtifactStore } from '../../../../app/service/replay/artifacts'
import { S3PrivateExportArtifactStore } from '../../../../app/service/reporting/artifacts'
import { S3PrivateSourceMapArtifactStore } from '../../../../app/service/sourcemaps/artifacts'

describe('S3CompatibleObjectStore', () => {
  it('uses a path-style private object key, SigV4 headers, encryption, and opaque refs', async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = []
    const objects = new S3CompatibleObjectStore(config(), async (url, init) => {
      requests.push({ url: new URL(url.toString()), init })
      return new Response(null, { status: 200 })
    })
    const store = new S3PrivateReplayArtifactStore(objects)
    const artifact = await store.put({ tenantId: 'tenant', projectId: 'project', sessionId: 'session', chunkId: 'chunk', contents: Buffer.from('{"ok":true}') })
    assert.match(artifact.ref, /^replay\/[0-9a-f-]{36}\.json$/)
    assert.equal(requests.length, 1)
    assert.match(requests[0]!.url.toString(), new RegExp(`https://objects\\.example\\.test/root/zhiji-private/zhiji-private/replay/${artifact.ref.slice('replay/'.length)}`))
    const headers = new Headers(requests[0]!.init!.headers)
    assert.equal(headers.get('x-amz-server-side-encryption'), 'AES256')
    assert.match(headers.get('authorization') ?? '', /^AWS4-HMAC-SHA256 Credential=access-key\/[0-9]{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=/)
    assert.equal(headers.get('authorization')?.includes('secret-key'), false)
    assert.equal(artifact.ref.includes('objects.example.test'), false)
  })

  it('reads missing objects as null, deletes idempotently, and fails closed on provider errors', async () => {
    const statuses = [ 404, 204, 500 ]
    const objects = new S3CompatibleObjectStore(config(), async () => new Response(null, { status: statuses.shift()! }))
    assert.equal(await objects.read('replay/10000000-0000-4000-8000-000000000001.json'), null)
    await objects.remove('replay/10000000-0000-4000-8000-000000000001.json')
    await assert.rejects(() => objects.put('replay/10000000-0000-4000-8000-000000000001.json', Buffer.from('x')), /s3_artifact_store_put_failed:500/)
  })

  it('bounds refs and validates all three artifact contracts before network access', async () => {
    let calls = 0
    const objects = new S3CompatibleObjectStore(config(), async () => { calls += 1; return new Response(null, { status: 200 }) })
    const replay = new S3PrivateReplayArtifactStore(objects)
    const exports = new S3PrivateExportArtifactStore(objects)
    const maps = new S3PrivateSourceMapArtifactStore(objects)
    assert.throws(() => replay.read('../secret'), /invalid_replay_artifact_ref/)
    assert.throws(() => exports.read('replay/10000000-0000-4000-8000-000000000001.json'), /invalid_private_artifact_ref/)
    assert.throws(() => maps.read('sourcemap/../../secret'), /invalid_sourcemap_artifact_ref/)
    assert.equal(calls, 0)
  })

  it('requires a complete secure deployment configuration', () => {
    assert.equal(s3ArtifactObjectStoreFromEnvironment({}), undefined)
    assert.throws(() => s3ArtifactObjectStoreFromEnvironment({ ZHIJI_ARTIFACT_S3_ENDPOINT: 'https://objects.example.test' }), /s3_artifact_store_configuration_incomplete/)
    assert.throws(() => new S3CompatibleObjectStore({ ...config(), endpoint: 'http://objects.example.test' }), /s3_artifact_store_endpoint_invalid/)
    assert.throws(() => new S3CompatibleObjectStore({ ...config(), prefix: '../public' }), /s3_artifact_store_prefix_invalid/)
    assert.throws(() => s3ArtifactObjectStoreFromEnvironment({
      ZHIJI_ARTIFACT_S3_ENDPOINT: 'https://objects.example.test',
      ZHIJI_ARTIFACT_S3_BUCKET: 'zhiji-private',
      ZHIJI_ARTIFACT_S3_PREFIX: 'zhiji-private',
      ZHIJI_ARTIFACT_S3_REGION: 'us-east-1',
      ZHIJI_ARTIFACT_S3_ACCESS_KEY_ID: 'access-key',
      ZHIJI_ARTIFACT_S3_SECRET_ACCESS_KEY: 'secret-key',
      ZHIJI_ARTIFACT_S3_COMPATIBILITY: 'unknown',
    }), /s3_artifact_store_compatibility_invalid/)
  })

  it('signs the Alibaba OSS S3 compatibility header when enabled', async () => {
    let request: RequestInit | undefined
    let requestUrl: URL | undefined
    const objects = new S3CompatibleObjectStore({ ...config(), compatibilityMode: 'aliyun-oss' }, async (url, init) => {
      requestUrl = new URL(url.toString())
      request = init
      return new Response(null, { status: 200 })
    })
    await objects.put('sourcemap/10000000-0000-4000-8000-000000000001.json', Buffer.from('{}'))
    const headers = new Headers(request!.headers)
    assert.equal(requestUrl!.toString(), 'https://zhiji-private.objects.example.test/root/zhiji-private/sourcemap/10000000-0000-4000-8000-000000000001.json')
    assert.equal(headers.get('x-oss-s3-compat'), 'true')
    assert.equal(headers.get('authorization')?.includes('x-oss-s3-compat'), false)
  })
})

function config() {
  return { endpoint: 'https://objects.example.test/root/', bucket: 'zhiji-private', prefix: 'zhiji-private', region: 'us-east-1', accessKeyId: 'access-key', secretAccessKey: 'secret-key' }
}
