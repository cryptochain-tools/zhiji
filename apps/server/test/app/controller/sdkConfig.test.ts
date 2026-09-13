import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import SdkConfigController from '../../../app/controller/sdkConfig'

describe('SdkConfigController CORS preflight', () => {
  it('accepts an exact Origin without requiring the actual request key', async () => {
    const context = requestContext('https://app.example.com')
    let allowedOrigin = ''
    const controller = {
      ctx: context,
      setCorsHeaders(origin: string) { allowedOrigin = origin },
    }

    await (SdkConfigController.prototype.preflight as unknown as Function).call(controller)

    assert.equal(context.status, 204)
    assert.equal(allowedOrigin, 'https://app.example.com')
  })

  it('rejects a missing or non-origin preflight caller', async () => {
    for (const origin of [ '', 'https://app.example.com/path' ]) {
      const controller = { ctx: requestContext(origin), setCorsHeaders() {} }
      await assert.rejects(
        () => (SdkConfigController.prototype.preflight as unknown as Function).call(controller),
        (error: Error & { code?: string }) => error.code === 'invalid_origin',
      )
    }
  })
})

function requestContext(origin: string) {
  return {
    status: 0,
    get(name: string) { return name.toLowerCase() === 'origin' ? origin : '' },
  }
}
