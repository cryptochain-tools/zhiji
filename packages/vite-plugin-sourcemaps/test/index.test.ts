import assert from 'node:assert/strict'
import test from 'node:test'

import type { OutputBundle } from 'vite'

import { prepareSourceMap, uploadBundleMaps } from '../src/index.js'

const validMap = JSON.stringify({
  version: 3,
  sources: ['../../src/main.ts'],
  sourcesContent: ['const secret = true'],
  names: [],
  mappings: 'AAAA',
})

test('removes sourcesContent before hashing and uploading', () => {
  const map = prepareSourceMap(validMap)
  assert.equal(JSON.parse(map.content).sourcesContent, undefined)
  assert.equal(map.sha256.length, 64)
})

test('rejects unsafe source paths and malformed mappings', () => {
  assert.throws(() => prepareSourceMap(JSON.stringify({ version: 3, sources: ['/home/example/app.ts'], names: [], mappings: 'AAAA' })), /unsafe/)
  assert.throws(() => prepareSourceMap(JSON.stringify({ version: 3, sources: ['src/a.ts'], names: [], mappings: 'g' })), /VLQ/)
})

test('accepts the API data envelope, removes maps, and strips sourceMappingURL comments', async () => {
  const bundle = {
    'assets/app.js': { type: 'chunk', fileName: 'assets/app.js', code: 'console.log(1)\n//# sourceMappingURL=app.js.map', imports: [], dynamicImports: [], modules: {}, exports: [], facadeModuleId: null, isEntry: true, isDynamicEntry: false, isImplicitEntry: false, name: 'app', preliminaryFileName: 'assets/app.js', sourcemapFileName: null, map: null, referencedFiles: [], moduleIds: [], importedBindings: {}, implicitlyLoadedBefore: [] },
    'assets/app.js.map': { type: 'asset', fileName: 'assets/app.js.map', source: validMap, name: undefined, needsCodeReference: false, originalFileName: null, originalFileNames: [] },
  } as unknown as OutputBundle
  let request: Request | undefined
  await uploadBundleMaps(bundle, {
    endpoint: new URL('https://errors.example.com/api/sourcemaps/upload'),
    key: 'test-key-that-is-long-enough',
    release: '1.2.3',
    dist: 'default',
    publicBasePath: '/',
    fetch: async (input, init) => {
      request = new Request(input, init)
      const body = await request.json() as { map_sha256: string; map: string }
      assert.equal(JSON.parse(body.map).sourcesContent, undefined)
      return new Response(JSON.stringify({ data: { artifact: { map_sha256: body.map_sha256 } } }), { status: 201 })
    },
  })
  assert.equal(bundle['assets/app.js.map'], undefined)
  assert.equal((bundle['assets/app.js'] as { code: string }).code.includes('sourceMappingURL'), false)
  assert.equal(request?.headers.get('X-Zhiji-SourceMap-Key'), 'test-key-that-is-long-enough')
})

test('does not remove any source map when an upload fails', async () => {
  const bundle = {
    'app.js': { type: 'chunk', fileName: 'app.js', code: '//# sourceMappingURL=app.js.map', imports: [], dynamicImports: [], modules: {}, exports: [], facadeModuleId: null, isEntry: true, isDynamicEntry: false, isImplicitEntry: false, name: 'app', preliminaryFileName: 'app.js', sourcemapFileName: null, map: null, referencedFiles: [], moduleIds: [], importedBindings: {}, implicitlyLoadedBefore: [] },
    'app.js.map': { type: 'asset', fileName: 'app.js.map', source: validMap, name: undefined, needsCodeReference: false, originalFileName: null, originalFileNames: [] },
  } as unknown as OutputBundle
  await assert.rejects(() => uploadBundleMaps(bundle, {
    endpoint: new URL('https://errors.example.com/api/sourcemaps/upload'), key: 'test-key-that-is-long-enough', release: '1.2.3', dist: 'default', publicBasePath: '/', fetch: async () => new Response(null, { status: 500 }),
  }), /HTTP 500/)
  assert.ok(bundle['app.js.map'])
  assert.match((bundle['app.js'] as { code: string }).code, /sourceMappingURL/)
})

import { promises as dns } from 'node:dns'
import { zhijiSourceMaps } from '../src/index.js'

test('refuses browser-exposed VITE keys before any upload', async () => {
  const plugin = zhijiSourceMaps({ enabled: true, endpoint: 'https://errors.example.com/api/sourcemaps/upload', key: 'VITE_ZHIJI_SOURCEMAP_KEY', release: '1.0.0' })
  plugin.configResolved?.({ command: 'build', mode: 'production', build: { ssr: false } } as never)
  await assert.rejects(() => plugin.generateBundle?.({} as never, {} as never) as Promise<void>, /browser-exposed/)
})

test('refuses a hostname whose real DNS answer is private', async () => {
  const originalLookup = dns.lookup
  Object.defineProperty(dns, 'lookup', { configurable: true, value: async () => [{ address: '127.0.0.1', family: 4 }] })
  try {
    const plugin = zhijiSourceMaps({ enabled: true, endpoint: 'https://errors.example.test/api/sourcemaps/upload', key: 'test-key-that-is-long-enough', release: '1.0.0' })
    plugin.configResolved?.({ command: 'build', mode: 'production', build: { ssr: false } } as never)
    await assert.rejects(() => plugin.generateBundle?.({} as never, {} as never) as Promise<void>, /non-public/)
  } finally {
    Object.defineProperty(dns, 'lookup', { configurable: true, value: originalLookup })
  }
})

test('only uploads from a production non-SSR build lifecycle', async () => {
  const plugin = zhijiSourceMaps({ enabled: true, endpoint: 'https://errors.example.com/api/sourcemaps/upload', key: 'test-key-that-is-long-enough', release: '1.0.0' })
  plugin.configResolved?.({ command: 'build', mode: 'development', build: { ssr: false } } as never)
  await assert.rejects(() => plugin.generateBundle?.({} as never, {} as never) as Promise<void>, /production, non-SSR/)
})
