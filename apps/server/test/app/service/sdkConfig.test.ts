import assert from 'node:assert/strict'
import { normalizeOrigin } from '../../../app/service/sdkConfig'

describe('SDK config contract', () => {
  it('only accepts exact HTTP(S) origins', () => {
    assert.equal(normalizeOrigin('https://app.example.com'), 'https://app.example.com')
    assert.equal(normalizeOrigin('http://localhost:5173'), 'http://localhost:5173')
    assert.equal(normalizeOrigin('https://app.example.com/path'), null)
    assert.equal(normalizeOrigin('https://app.example.com?debug=1'), null)
    assert.equal(normalizeOrigin('ftp://app.example.com'), null)
  })
})
