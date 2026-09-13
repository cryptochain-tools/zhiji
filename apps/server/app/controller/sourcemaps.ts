import { Controller } from 'egg'
import { SourceMapUploadRequest } from '../contracts/sourcemaps'
import { success } from '../lib/http'

export default class SourceMapsController extends Controller {
  async upload() {
    const body = this.ctx.request.body as Omit<SourceMapUploadRequest, 'key'> | undefined
    const result = await this.ctx.service.sourcemaps.index.upload({
      key: this.ctx.get('x-zhiji-sourcemap-key'),
      release: body?.release ?? '',
      dist: body?.dist,
      artifact_path: body?.artifact_path ?? '',
      map: body?.map ?? '',
      map_sha256: body?.map_sha256,
      supersede: body?.supersede,
    })
    success(this.ctx, result)
  }
}
