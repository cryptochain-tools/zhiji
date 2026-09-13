import assert from 'node:assert/strict'
import { encodeHeatmapId, parseHeatmapId, parseHeatmapQuery } from '../../../../app/service/heatmaps/contracts'

describe('heatmap contracts', () => {
  it('requires stable scoped dimensions and bounds the reporting window', () => {
    const now = new Date('2026-09-12T12:00:00.000Z')
    const query = parseHeatmapQuery({ page_key: '/pricing', page_version: 'release-1', viewport_width_bucket: 1200, action: 'rage_click' }, now)
    assert.equal(query.pageKey, '/pricing')
    assert.equal(query.action, 'rage_click')
    assert.equal(query.viewportWidthBucket, 1200)
    assert.throws(() => parseHeatmapQuery({ page_key: '/pricing?email=a@example.com' }, now))
    assert.throws(() => parseHeatmapQuery({ page_key: '/pricing', viewport_width_bucket: 999 }, now))
    assert.throws(() => parseHeatmapQuery({ page_key: '/pricing', from: '2026-08-01T00:00:00.000Z' }, now))
  })

  it('uses an opaque reversible-only-at-the-server heatmap identifier', () => {
    const id = encodeHeatmapId({ pageKey: '/pricing', pageVersion: 'release-1', viewportWidthBucket: 1200, action: 'autocapture_click' })
    assert.deepEqual(parseHeatmapId(id), { pageKey: '/pricing', pageVersion: 'release-1', viewportWidthBucket: 1200, action: 'autocapture_click' })
    assert.throws(() => parseHeatmapId('not-a-heatmap'))
  })
})
