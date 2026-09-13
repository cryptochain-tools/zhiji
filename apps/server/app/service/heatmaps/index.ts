import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { encodeHeatmapId, HeatmapScope, parseHeatmapId, parseHeatmapQuery } from './contracts'
import { HeatmapRepository } from './repository'

export default class HeatmapsService extends Service {
  async list(scope: HeatmapScope, raw: unknown) {
    if (!this.config.zhiji.database.configured) throw httpError(503, 'heatmaps_unavailable', 'Heatmaps are unavailable')
    const query = parseHeatmapQuery(raw)
    const rows = await new HeatmapRepository(this.config.zhiji.database).series(scope, query)
    return {
      from: query.from.toISOString(), to: query.to.toISOString(), page_key: query.pageKey,
      items: rows.map(row => ({ id: encodeHeatmapId({ pageKey: row.page_key, pageVersion: row.page_version, viewportWidthBucket: row.viewport_width_bucket, action: row.action }),
        page_key: row.page_key, page_version: row.page_version || null, viewport_width_bucket: row.viewport_width_bucket, action: row.action,
        sample_count: row.sample_count, coverage_from: row.coverage_from.toISOString(), coverage_to: row.coverage_to.toISOString(), has_screenshot: row.has_screenshot })),
    }
  }

  async detail(scope: HeatmapScope, heatmapId: string, raw: unknown) {
    if (!this.config.zhiji.database.configured) throw httpError(503, 'heatmaps_unavailable', 'Heatmaps are unavailable')
    const query = parseHeatmapQuery(raw)
    const id = parseHeatmapId(heatmapId)
    if (query.pageKey !== id.pageKey) throw httpError(400, 'invalid_heatmap_query', 'Heatmap query is invalid')
    const bins = await new HeatmapRepository(this.config.zhiji.database).bins(scope, query, id)
    return { id: heatmapId, from: query.from.toISOString(), to: query.to.toISOString(), page_key: id.pageKey, page_version: id.pageVersion || null,
      viewport_width_bucket: id.viewportWidthBucket, action: id.action, grid_size: 24, bins, background: { available: false } }
  }

  // Existing route compatibility. New routes use list() and detail().
  async show(scope: HeatmapScope, raw: unknown) {
    if (!this.config.zhiji.database.configured) throw httpError(503, 'heatmaps_unavailable', 'Heatmaps are unavailable')
    const query = parseHeatmapQuery(raw)
    const bins = await new HeatmapRepository(this.config.zhiji.database).bins(scope, query)
    return { from: query.from.toISOString(), to: query.to.toISOString(), page_key: query.pageKey, action: query.action ?? null, grid_size: 24, bins }
  }
}
