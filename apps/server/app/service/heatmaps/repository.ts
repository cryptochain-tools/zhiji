import { DatabaseClient } from '../database/types'
import { HeatmapAction, HeatmapId, HeatmapQuery, HeatmapScope } from './contracts'

export interface HeatmapBin { x: number; y: number; count: number }
export interface HeatmapSeries { page_key: string; page_version: string; viewport_width_bucket: number; action: HeatmapAction; sample_count: number; coverage_from: Date; coverage_to: Date; has_screenshot: boolean }

export class HeatmapRepository {
  constructor(private readonly database: DatabaseClient) {}

  async series(scope: HeatmapScope, query: HeatmapQuery): Promise<HeatmapSeries[]> {
    const result = await this.database.query<HeatmapSeries>(
      `SELECT series.page_key, series.page_version, series.viewport_width_bucket, series.action,
              sum(series.sample_count)::bigint AS sample_count, min(series.first_occurred_at) AS coverage_from,
              max(series.last_occurred_at) AS coverage_to,
              EXISTS (SELECT 1 FROM heatmap_screenshots AS screenshots
                      WHERE screenshots.tenant_id = series.tenant_id AND screenshots.project_id = series.project_id
                        AND screenshots.page_key = series.page_key AND screenshots.page_version = series.page_version
                        AND screenshots.viewport_width_bucket = series.viewport_width_bucket) AS has_screenshot
       FROM heatmap_series_daily AS series
       WHERE series.tenant_id = $1 AND series.project_id = $2 AND series.page_key = $3
         AND series.occurred_on >= $4::date AND series.occurred_on < $5::date
         AND ($6::text IS NULL OR series.page_version = $6)
         AND ($7::integer IS NULL OR series.viewport_width_bucket = $7)
         AND ($8::text IS NULL OR series.action = $8)
       GROUP BY series.tenant_id, series.project_id, series.page_key, series.page_version, series.viewport_width_bucket, series.action
       ORDER BY sample_count DESC, series.page_version ASC, series.viewport_width_bucket ASC, series.action ASC
       LIMIT 200`,
      [scope.tenantId, scope.projectId, query.pageKey, query.from.toISOString().slice(0, 10), query.to.toISOString().slice(0, 10), query.pageVersion ?? null, query.viewportWidthBucket ?? null, query.action ?? null],
    )
    return result.rows.map(row => ({ ...row, viewport_width_bucket: Number(row.viewport_width_bucket), sample_count: Number(row.sample_count), has_screenshot: row.has_screenshot === true }))
  }

  async bins(scope: HeatmapScope, query: HeatmapQuery, id?: HeatmapId): Promise<HeatmapBin[]> {
    const result = await this.database.query<HeatmapBin>(
      `SELECT bin_x AS x, bin_y AS y, sum(event_count)::bigint AS count
       FROM heatmap_bins_daily
       WHERE tenant_id = $1 AND project_id = $2 AND page_key = $3
         AND ($4::text IS NULL OR page_version = $4)
         AND ($5::integer IS NULL OR viewport_width_bucket = $5)
         AND ($6::text IS NULL OR action = $6)
         AND occurred_on >= $7::date AND occurred_on < $8::date
       GROUP BY bin_x, bin_y ORDER BY count DESC, y, x LIMIT 576`,
      [scope.tenantId, scope.projectId, id?.pageKey ?? query.pageKey, id?.pageVersion ?? query.pageVersion ?? null,
        id?.viewportWidthBucket ?? query.viewportWidthBucket ?? null, id?.action ?? query.action ?? null,
        query.from.toISOString().slice(0, 10), query.to.toISOString().slice(0, 10)],
    )
    return result.rows.map(row => ({ x: Number(row.x), y: Number(row.y), count: Number(row.count) }))
  }
}
